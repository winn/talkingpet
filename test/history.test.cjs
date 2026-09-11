const test = require('node:test');
const assert = require('node:assert/strict');

function createHistoryManager(maxHistory = 30) {
    let historyStack = [];
    let historyIndex = -1;

    return {
        init(initialState) {
            historyStack = [initialState];
            historyIndex = 0;
        },
        push(state) {
            if (historyIndex < historyStack.length - 1) {
                historyStack = historyStack.slice(0, historyIndex + 1);
            }
            historyStack.push(state);
            if (historyStack.length > maxHistory) {
                historyStack.shift();
            }
            historyIndex = historyStack.length - 1;
        },
        undo() {
            if (historyIndex <= 0) return null;
            historyIndex--;
            return historyStack[historyIndex];
        },
        redo() {
            if (historyIndex >= historyStack.length - 1) return null;
            historyIndex++;
            return historyStack[historyIndex];
        },
        canUndo() {
            return historyIndex > 0;
        },
        canRedo() {
            return historyIndex < historyStack.length - 1;
        },
        get index() {
            return historyIndex;
        },
        get length() {
            return historyStack.length;
        },
        get current() {
            return historyStack[historyIndex];
        }
    };
}

test('history manager starts with initial state and cannot undo', () => {
    const history = createHistoryManager();
    history.init('state-0');
    assert.equal(history.current, 'state-0');
    assert.equal(history.canUndo(), false);
    assert.equal(history.canRedo(), false);
});

test('pushing actions advances history and enables undo', () => {
    const history = createHistoryManager();
    history.init('state-0');
    history.push('state-1');
    history.push('state-2');

    assert.equal(history.current, 'state-2');
    assert.equal(history.canUndo(), true);
    assert.equal(history.canRedo(), false);
    assert.equal(history.length, 3);
});

test('undo moves backward step-by-step and enables redo', () => {
    const history = createHistoryManager();
    history.init('state-0');
    history.push('state-1');
    history.push('state-2');

    const u1 = history.undo();
    assert.equal(u1, 'state-1');
    assert.equal(history.canUndo(), true);
    assert.equal(history.canRedo(), true);

    const u2 = history.undo();
    assert.equal(u2, 'state-0');
    assert.equal(history.canUndo(), false);
    assert.equal(history.canRedo(), true);

    // Extra undo at boundary does nothing
    assert.equal(history.undo(), null);
    assert.equal(history.current, 'state-0');
});

test('redo moves forward step-by-step to restored states', () => {
    const history = createHistoryManager();
    history.init('state-0');
    history.push('state-1');
    history.push('state-2');

    history.undo();
    history.undo();

    const r1 = history.redo();
    assert.equal(r1, 'state-1');
    assert.equal(history.canUndo(), true);
    assert.equal(history.canRedo(), true);

    const r2 = history.redo();
    assert.equal(r2, 'state-2');
    assert.equal(history.canUndo(), true);
    assert.equal(history.canRedo(), false);

    // Extra redo at boundary does nothing
    assert.equal(history.redo(), null);
    assert.equal(history.current, 'state-2');
});

test('new action after undo truncates redo history', () => {
    const history = createHistoryManager();
    history.init('state-0');
    history.push('state-1');
    history.push('state-2');

    history.undo(); // at state-1
    history.push('state-3'); // new stroke after undo

    assert.equal(history.current, 'state-3');
    assert.equal(history.length, 3); // state-0, state-1, state-3
    assert.equal(history.canRedo(), false);

    history.undo();
    assert.equal(history.current, 'state-1');
    history.undo();
    assert.equal(history.current, 'state-0');
});
