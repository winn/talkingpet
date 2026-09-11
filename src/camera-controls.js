export function configureOrbitControls(controls, THREE_CONSTANTS) {
  controls.enablePan = true;
  controls.enableZoom = true;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.mouseButtons = {
    LEFT: THREE_CONSTANTS.MOUSE.ROTATE,
    MIDDLE: THREE_CONSTANTS.MOUSE.PAN,
    RIGHT: THREE_CONSTANTS.MOUSE.PAN,
  };
  controls.touches = {
    ONE: THREE_CONSTANTS.TOUCH.ROTATE,
    TWO: THREE_CONSTANTS.TOUCH.DOLLY_ROTATE,
  };
}
