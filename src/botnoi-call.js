// Live preview_call client, matching Talking Jelly's voice socket.
// Mic frames go up as binary; the server sends TTS binary plus JSON events.

const MULAW_TABLE = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const ulaw = i ^ 0xff;
  const t = ((ulaw & 0x0f) << 3) + 0x84;
  const exponent = (ulaw >> 4) & 0x07;
  const man = exponent > 0 ? t << (exponent - 1) : t;
  const sign = ulaw & 0x80 ? -1 : 1;
  MULAW_TABLE[i] = (sign * (man + 0.5) * 2) / 65535;
}

const WORKLET_SRC = `
class MicPublisher extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = new Float32Array(2048);
    this._n = 0;
  }
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (ch && ch.length) {
      if (this._n + ch.length > this._buf.length) {
        this._buf = new Float32Array(this._buf.length * 2);
      }
      this._buf.set(ch, this._n);
      this._n += ch.length;
      const frame = Math.round(sampleRate * 0.02);
      if (this._n >= frame) {
        const out = this._buf.slice(0, this._n);
        this.port.postMessage(out, [out.buffer]);
        this._n = 0;
      }
    }
    return true;
  }
}
registerProcessor("mic-publisher", MicPublisher);
`;

function linearToMulaw(sample) {
  const BIAS = 0x84;
  const CLIP = 32635;
  let s = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  s = Math.max(-CLIP, Math.min(CLIP, s));
  const sign = s < 0 ? 0x80 : 0x00;
  if (sign) s = -s;
  s += BIAS;
  let exponent = 7;
  const expLut = [0x4000, 0x2000, 0x1000, 0x0800, 0x0400, 0x0200, 0x0100, 0x0000];
  for (let i = 0; i < 8; i++) {
    if (s & expLut[i]) {
      exponent = 7 - i;
      break;
    }
  }
  const mantissa = (s >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

class BotnoiCall {
  constructor(opts) {
    this.o = opts;
    this.ws = null;
    this.seq = 0;
    this.sessionId = "";
    this.audioCtx = null;
    this.micStream = null;
    this.worklet = null;
    this.workletUrl = null;
    this.rxRate = 16000;
    this.rxUlaw = false;
    this.txRate = 16000;
    this.txUlaw = false;
    this.tail = 0;
    this.sources = new Set();
    this.announcedStart = false;
    this.pingTimer = null;
    this.stopped = false;
    this.ready = false;
  }

  async start() {
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch {
      this.cleanup();
      this.o.onError?.("mic_denied");
      return;
    }

    const url = `${this.o.wssUrl}?api_key=${encodeURIComponent(this.o.apiKey)}&agent_id=${encodeURIComponent(this.o.agentId)}`;
    let ws;
    try {
      ws = new WebSocket(url);
    } catch {
      this.cleanup();
      this.o.onError?.("network");
      return;
    }
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    const closedEarly = setTimeout(() => {
      if (this.stopped || ws.readyState === WebSocket.OPEN) return;
      this.cleanup();
      this.o.onError?.("network");
    }, 10000);
    ws.onmessage = (event) => this.onMessage(event);
    ws.onclose = (event) => {
      clearTimeout(closedEarly);
      if (this.stopped) return;
      const reason = String(event.reason || "");
      if (!this.ready) {
        this.o.onError?.(reason.includes("api_key") ? "key_rejected" : "network");
      } else {
        this.o.onEnded?.(reason || undefined);
      }
      this.cleanupAudio();
    };
    ws.onerror = () => clearTimeout(closedEarly);
  }

  send(type, parameters = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.seq += 1;
    this.ws.send(
      JSON.stringify({
        version: "2",
        type,
        seq: this.seq,
        id: this.sessionId,
        parameters,
      }),
    );
  }

  onMessage(event) {
    if (typeof event.data === "string") {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.type === "opened") {
        this.ready = true;
        this.sessionId = String(msg.id ?? "");
        this.seq = Number(msg.clientseq ?? 0);
        const media = msg.parameters?.media?.[0];
        this.rxRate = media?.sampleRateHz ?? 16000;
        this.rxUlaw = String(media?.type ?? "audio/L16").toUpperCase().includes("ULAW");
        this.txRate = this.rxRate;
        this.txUlaw = this.rxUlaw;
        void this.startAudio();
        this.pingTimer = setInterval(() => this.send("ping"), 10000);
        this.o.onReady?.();
        return;
      }
      if (msg.type === "event") {
        const entities = msg.parameters?.entities ?? [];
        for (const ent of entities) {
          if (ent.type === "user_turn_response") {
            const text = ent.data?.transcript?.result?.text ?? "";
            if (text) this.o.onTurn?.("user", text, !!ent.data?.is_final);
          } else if (ent.type === "bot_turn_response") {
            const text = ent.data?.output ?? "";
            if (text) this.o.onTurn?.("agent", text, false);
          } else if (ent.type === "barge_in") {
            this.stopPlayback();
          }
        }
        return;
      }
      if (msg.type === "closed" || msg.type === "disconnect") {
        this.o.onEnded?.();
        this.stop();
      }
      return;
    }
    this.enqueueTTS(event.data);
  }

  async startAudio() {
    try {
      this.audioCtx = new AudioContext({ sampleRate: 48000 });
      await this.audioCtx.resume();
      const src = this.audioCtx.createMediaStreamSource(this.micStream);
      const blob = new Blob([WORKLET_SRC], { type: "application/javascript" });
      this.workletUrl = URL.createObjectURL(blob);
      await this.audioCtx.audioWorklet.addModule(this.workletUrl);
      this.worklet = new AudioWorkletNode(this.audioCtx, "mic-publisher");
      this.worklet.port.onmessage = (event) => this.sendMicFrame(event.data);
      src.connect(this.worklet);
      const mute = this.audioCtx.createGain();
      mute.gain.value = 0;
      this.worklet.connect(mute);
      mute.connect(this.audioCtx.destination);
    } catch {
      this.o.onError?.("no_mic");
      this.stop();
    }
  }

  sendMicFrame(batch) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.audioCtx) return;
    const ctxRate = this.audioCtx.sampleRate;
    const targetLen = Math.round((this.txRate * batch.length) / ctxRate);
    let pcm = batch;
    if (targetLen !== batch.length) {
      pcm = new Float32Array(targetLen);
      const ratio = batch.length / targetLen;
      for (let i = 0; i < targetLen; i++) {
        const x = i * ratio;
        const i0 = Math.floor(x);
        const i1 = Math.min(i0 + 1, batch.length - 1);
        const f = x - i0;
        pcm[i] = batch[i0] * (1 - f) + batch[i1] * f;
      }
    }
    if (this.txUlaw) {
      const bytes = new Uint8Array(pcm.length);
      for (let i = 0; i < pcm.length; i++) bytes[i] = linearToMulaw(pcm[i]);
      this.ws.send(bytes.buffer);
    } else {
      const out = new DataView(new ArrayBuffer(pcm.length * 2));
      for (let i = 0; i < pcm.length; i++) {
        const s = Math.max(-1, Math.min(1, pcm[i]));
        out.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      }
      this.ws.send(out.buffer);
    }
  }

  enqueueTTS(buf) {
    const ctx = this.audioCtx;
    if (!ctx || ctx.state !== "running") return;
    const bytes = new Uint8Array(buf);
    let samples;
    if (this.rxUlaw) {
      samples = new Float32Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) samples[i] = MULAW_TABLE[bytes[i]];
    } else {
      const view = new DataView(buf);
      const n = Math.floor(bytes.length / 2);
      samples = new Float32Array(n);
      for (let i = 0; i < n; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
    }
    const audioBuf = ctx.createBuffer(1, samples.length, this.rxRate);
    audioBuf.getChannelData(0).set(samples);
    const source = ctx.createBufferSource();
    source.buffer = audioBuf;
    source.connect(ctx.destination);
    const when = Math.max(ctx.currentTime + 0.06, this.tail);
    source.start(when);
    this.tail = when + audioBuf.duration;
    if (!this.announcedStart) {
      this.announcedStart = true;
      this.send("playback_started");
      this.o.onAgentSpeaking?.(true);
    }
    source.onended = () => {
      this.sources.delete(source);
      if (this.sources.size === 0 && this.announcedStart && !this.stopped) {
        this.announcedStart = false;
        this.o.onAgentSpeaking?.(false);
        this.send("playback_completed");
      }
    };
    this.sources.add(source);
  }

  stopPlayback() {
    for (const source of this.sources) {
      try {
        source.onended = null;
        source.stop();
      } catch {
        /* already stopped */
      }
    }
    this.sources.clear();
    if (this.announcedStart) {
      this.announcedStart = false;
      this.o.onAgentSpeaking?.(false);
    }
    this.tail = 0;
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    try {
      if (this.ws?.readyState === WebSocket.OPEN) this.send("close", { reason: "end" });
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.cleanup();
  }

  cleanupAudio() {
    this.stopPlayback();
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    try {
      this.worklet?.disconnect();
    } catch {
      /* ignore */
    }
    this.worklet = null;
    this.micStream?.getTracks().forEach((track) => track.stop());
    this.micStream = null;
    if (this.workletUrl) URL.revokeObjectURL(this.workletUrl);
    this.workletUrl = null;
    this.audioCtx?.close().catch(() => {});
    this.audioCtx = null;
  }

  cleanup() {
    this.cleanupAudio();
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
    this.o.onAgentSpeaking?.(false);
  }
}

let active = null;

export function stopBotnoiCall() {
  active?.stop();
  active = null;
}

export function startBotnoiCall(opts) {
  stopBotnoiCall();
  active = new BotnoiCall(opts);
  void active.start();
  return active;
}
