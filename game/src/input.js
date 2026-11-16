// Input: pointer lock, a key set, and the mouse delta accumulated since the last step. Reading
// takes the delta and clears it, so a frame that runs two fixed steps consumes the look once and
// the sim stays independent of the frame rate.
export function createInput(element, onLockChange) {
  const keys = new Set();
  const state = {
    keys,
    firing: false,
    justPressed: new Set(),
    locked: false,
    enabled: false,
  };
  let lookX = 0;
  let lookY = 0;

  function requestLock() {
    if (document.pointerLockElement === element) return;
    element.requestPointerLock?.();
  }

  function onKeyDown(event) {
    if (!state.enabled) return;
    if (event.code === 'Tab') event.preventDefault();
    if (event.repeat) return;
    keys.add(event.code);
    state.justPressed.add(event.code);
    if (event.code === 'KeyB' || event.code === 'Escape' || event.code === 'Tab') event.preventDefault();
  }

  function onKeyUp(event) {
    keys.delete(event.code);
  }

  function onMouseDown(event) {
    if (!state.enabled) return;
    if (event.button === 0) state.firing = true;
  }

  function onMouseUp(event) {
    if (event.button === 0) state.firing = false;
  }

  function onMouseMove(event) {
    if (!state.locked || !state.enabled) return;
    lookX += event.movementX;
    lookY += event.movementY;
  }

  function onLock() {
    state.locked = document.pointerLockElement === element;
    if (!state.locked) {
      state.firing = false;
      keys.clear();
    }
    onLockChange(state.locked);
  }

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  document.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('pointerlockchange', onLock);
  window.addEventListener('blur', () => {
    keys.clear();
    state.firing = false;
  });

  return {
    state,
    requestLock,
    // The look delta in pixels since the last call, then cleared.
    takeLook() {
      const out = { x: lookX, y: lookY };
      lookX = 0;
      lookY = 0;
      return out;
    },
    // Edge-triggered keys: true once per physical press.
    consume(code) {
      if (!state.justPressed.has(code)) return false;
      state.justPressed.delete(code);
      return true;
    },
    endFrame() {
      state.justPressed.clear();
    },
    setEnabled(value) {
      state.enabled = value;
      if (!value) {
        keys.clear();
        state.firing = false;
      }
    },
  };
}
