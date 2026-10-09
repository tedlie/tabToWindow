import type { GridMode, IOptions, WindowID, WindowProperty } from "./api.js";
import { getCloneBounds } from "./getCloneBounds.js";
import { getStorageWindowPropKey } from "./getStorageWindowPropKey.js";
import { getOptions, isCloneMode, isMenuButtonType, isWindowID } from "./options.js";

const kMaxClonePercentage = 0.8;
const kMinClonePercentage = 1.0 - kMaxClonePercentage;
const kDefaultDimensionPx = 1000;

// Helper functions
// -----------------------------------------------------------------------------

const getFromId = <T extends HTMLElement>(id: string, root = document) =>
  root.getElementById(id) as T;

const getFromClass = <T extends HTMLElement>(className: string, root = document) =>
  Array.from(root.getElementsByClassName(className)) as T[];

const getFromTag = <T extends HTMLElement>(tagName: string, root = document) =>
  Array.from(root.getElementsByTagName(tagName)) as T[];

// window that will be focused on pop-out
const getFocusedName = (): WindowID => {
  const focused = getFromClass<HTMLInputElement>("focus-option").find((option) => option.checked);
  return focused === undefined || focused.id === "focus-original" ? "original" : "new";
};

// grid mode for the resizing canvas: quarters (default) or thirds
const getGridMode = (): GridMode => {
  const gridEl = getFromClass<HTMLInputElement>("grid-option").find((option) => option.checked);
  return gridEl !== undefined && gridEl.id === "grid-thirds" ? "thirds" : "quarters";
};

void getOptions().then((options) => {
  // save current state
  const save = () => {
    const update: Partial<IOptions> = {
      focus: getFocusedName(),
      resizeOriginal: getFromId<HTMLInputElement>("resize-original").checked,
      copyFullscreen: getFromId<HTMLInputElement>("copy-fullscreen").checked,
      gridMode: getGridMode(),
    };

    const cloneModeEl = getFromClass<HTMLInputElement>("clone-mode-option").find(
      (cp) => cp.checked,
    );
    if (isCloneMode(cloneModeEl?.id)) {
      update.cloneMode = cloneModeEl.id;
    }

    const menuButtonEl = getFromClass<HTMLInputElement>("menu-button-option").find(
      (mb) => mb.checked,
    );
    const menuButtonValue = menuButtonEl?.getAttribute("data-value");
    if (isMenuButtonType(menuButtonValue)) {
      update.menuButtonType = menuButtonValue;
    }

    // window dimensions
    const screenEl = getFromId("screen");
    const screenOffsetWidth = screenEl.offsetWidth;
    const screenOffsetHeight = screenEl.offsetHeight;
    const windowEls = getFromClass("window");
    for (const windowEl of windowEls) {
      const windowId = windowEl.id;
      if (!isWindowID(windowId)) {
        throw new TypeError("Window element does not have a WindowID as its ID");
      }

      const windowWidth = windowEl.offsetWidth;
      const windowHeight = windowEl.offsetHeight;

      const left = windowEl.offsetLeft / screenOffsetWidth;
      const top = windowEl.offsetTop / screenOffsetHeight;
      const width = windowWidth / screenOffsetWidth;
      const height = windowHeight / screenOffsetHeight;

      switch (windowId) {
        case "original": {
          update.originalLeft = left;
          update.originalTop = top;
          update.originalWidth = width;
          update.originalHeight = height;
          break;
        }
        case "new": {
          update.newLeft = left;
          update.newTop = top;
          update.newWidth = width;
          update.newHeight = height;
          break;
        }
      }
    }

    void options.update(update);
  };

  // changing draggable/resizable windows, used when radio buttons override
  // resizing and positioning
  const updateWindowHandling = (inputId: string, windowId: WindowID, enableIfChecked: boolean) => {
    const checked = getFromId<HTMLInputElement>(inputId).checked;
    const action = enableIfChecked === checked ? "enable" : "disable";
    const $win = $(`#${windowId}`);
    $win.draggable(action);
    $win.resizable(action);
  };

  const updateResizeOriginal = () => {
    updateWindowHandling("resize-original", "original", true);
    const originalWin = getFromId("original");
    const isResizing = getFromId<HTMLInputElement>("resize-original").checked;
    if (isResizing) {
      originalWin.classList.remove("disabled");
    } else {
      originalWin.classList.add("disabled");
    }
  };

  const updateResizeNew = () => updateWindowHandling("clone-mode-no", "new", true);

  const updateClone = () => {
    const originalWin = getFromId("original");
    const newWin = getFromId("new");
    newWin.style.width = originalWin.style.width;
    newWin.style.height = originalWin.style.height;

    const monitor = getFromId("monitor");
    const displayBounds = {
      left: 0,
      top: 0,
      width: monitor.clientWidth,
      height: monitor.clientHeight,
    };

    const origBounds = {
      left: originalWin.offsetLeft,
      top: originalWin.offsetTop,
      width: originalWin.offsetWidth,
      height: originalWin.offsetHeight,
    };

    const newBounds = getCloneBounds(origBounds, displayBounds, options.get("cloneMode"));

    (Object.entries(newBounds) as [WindowProperty, number][]).forEach(([key, value]) => {
      newWin.style[key] = `${value}px`;
    });
  };

  // update appearance of windows depending on if they are active or not
  const updateFocus = () => {
    getFromClass("window").forEach((win) => {
      const isBlurred = win.id !== getFocusedName();
      if (isBlurred) {
        win.classList.add("blurred");
      } else {
        win.classList.remove("blurred");
      }
    });
  };

  const setWindowAsCurrent = (win: HTMLElement) => {
    getFromClass("window").forEach((_win) => {
      if (_win === win) {
        _win.classList.add("current");
      } else {
        _win.classList.remove("current");
      }
    });
  };

  const updateMaxDimensions = () => {
    const cloneMode = options.get("cloneMode");
    const $original = $("#original");
    const $parent = $original.parent();

    let maxWidth = $parent.width() ?? kDefaultDimensionPx;
    if (cloneMode === "clone-mode-horizontal") {
      maxWidth *= kMaxClonePercentage;
    }
    $original.resizable("option", "maxWidth", maxWidth);

    let maxHeight = $parent.height() ?? kDefaultDimensionPx;
    if (cloneMode === "clone-mode-vertical") {
      maxHeight *= kMaxClonePercentage;
    }
    $original.resizable("option", "maxHeight", maxHeight);
  };

  // Main Function
  // ---------------------------------------------------------------------------
  // Each chunk has specifically *not* been broken out into a named function
  // as then it's more difficult to tell when / where they are being called
  // and if it's more than one

  const main = () => {
    {
      // display shortcuts
      // -----------------------------------------------------------------------
      void chrome.commands.getAll().then((cmds) => {
        if (cmds.length === 0) {
          return;
        }

        cmds
          .filter((cmd) => cmd.name !== "_execute_action")
          .forEach((cmd) => {
            const name = document.createElement("span");
            name.textContent = `${cmd.description}:`;
            name.classList.add("shortcut-label");

            const shortcut = document.createElement("span");
            shortcut.classList.add("shortcut");
            shortcut.textContent = cmd.shortcut ?? "";

            const li = document.createElement("li");
            [name, shortcut].forEach((el) => li.appendChild(el));

            getFromId("shortcut-list").appendChild(li);
          });
      });
    }

    const gridsize = 20; // px to use for window grid
    {
      // Set monitor aspect ratio to match user's
      // -----------------------------------------------------------------------
      const monitor = getFromId("monitor");
      const ratio = screen.height / screen.width;
      const height = Math.round((monitor.clientWidth * ratio) / gridsize) * gridsize;
      monitor.style.height = `${height}px`;
    }

    // snap grid + visual grid helpers (quarters vs thirds)
    // -------------------------------------------------------------------------
    const getSnapGrid = (): [number, number] => {
      const screenEl = getFromId("screen");
      return getGridMode() === "thirds"
        ? [screenEl.clientWidth / 3, screenEl.clientHeight / 3]
        : [screenEl.clientWidth / gridsize, screenEl.clientHeight / gridsize];
    };

    const updateGrid = () => {
      getFromId("screen").classList.toggle("thirds", getGridMode() === "thirds");
      const grid = getSnapGrid();
      getFromClass("window").forEach((win) => {
        const $win = $(win);
        $win.draggable("option", "grid", grid);
        $win.resizable("option", "grid", grid);
      });
    };

    // jQuery UI snaps to the grid *after* applying containment, so a fractional
    // grid (thirds of the screen) can push a window past the screen edge.
    // Clamp the snapped geometry back inside on every drag/resize.
    const clampWindowToScreen = (
      position: { left: number; top: number },
      size: { width: number; height: number },
    ) => {
      const screenEl = getFromId("screen");
      position.left = Math.max(0, Math.min(position.left, screenEl.clientWidth - size.width));
      position.top = Math.max(0, Math.min(position.top, screenEl.clientHeight - size.height));
      size.width = Math.max(1, Math.min(size.width, screenEl.clientWidth - position.left));
      size.height = Math.max(1, Math.min(size.height, screenEl.clientHeight - position.top));
    };

    {
      // restore options
      // -----------------------------------------------------------------------
      getFromClass<HTMLInputElement>("focus-option").forEach((opt) => {
        opt.checked = opt.id.includes(options.get("focus"));
      });
      getFromId<HTMLInputElement>("resize-original").checked = options.get("resizeOriginal");
      const curCloneOption = getFromClass<HTMLInputElement>("clone-mode-option").find(
        (cp) => cp.id === options.get("cloneMode"),
      );
      if (curCloneOption !== undefined) {
        curCloneOption.checked = true;
      }
      getFromId<HTMLInputElement>("copy-fullscreen").checked = options.get("copyFullscreen");
      getFromClass<HTMLInputElement>("menu-button-option").forEach((opt) => {
        opt.checked = opt.id.includes(options.get("menuButtonType"));
      });
      const curGridOption = getFromClass<HTMLInputElement>("grid-option").find(
        (g) => g.id === `grid-${options.get("gridMode")}`,
      );
      if (curGridOption !== undefined) {
        curGridOption.checked = true;
      }
    }

    {
      // setup windows
      // -----------------------------------------------------------------------
      getFromClass("window").forEach((win) => {
        // Restore positions from options
        (["width", "height", "left", "top"] as WindowProperty[]).forEach((prop) => {
          const value = options.get(getStorageWindowPropKey(win.id as WindowID, prop));
          win.style[prop] = `${value * 100}%`;
        });

        const grid = getSnapGrid();

        let saveTimeout: number;
        const update = () => {
          const shouldUpdateClone = win.id === "original" && options.isCloneEnabled;
          if (shouldUpdateClone) {
            updateClone();
          }

          clearTimeout(saveTimeout);
          saveTimeout = window.setTimeout(save, 200);
        };

        const $win = $(win);

        $win.draggable({
          containment: "parent",
          grid,
          drag: (_event: JQueryEventObject, ui: JQueryUI.DraggableEventUIParams) => {
            clampWindowToScreen(ui.position, {
              width: win.offsetWidth,
              height: win.offsetHeight,
            });
            update();
          },
          start: update,
          stop: update,
        });

        const $winParent = $win.parent();
        const winParentWidth = $winParent.width() ?? kDefaultDimensionPx;
        const winParentHeight = $winParent.height() ?? kDefaultDimensionPx;

        $win.resizable({
          containment: "parent",
          handles: "all",
          grid,
          minWidth: winParentWidth * kMinClonePercentage,
          minHeight: winParentHeight * kMinClonePercentage,
          resize: (_event: JQueryEventObject, ui: JQueryUI.ResizableUIParams) => {
            const position = ui.position as { left: number; top: number };
            const size = ui.size as { width: number; height: number };
            clampWindowToScreen(position, size);
            update();
          },
          start: update,
          stop: update,
        });

        win.addEventListener("mousedown", () => setWindowAsCurrent(win), false);
        win.addEventListener("touchstart", () => setWindowAsCurrent(win), false);
      });

      updateResizeOriginal();
      updateResizeNew();
      updateFocus();
      updateGrid();
      updateMaxDimensions();
      if (options.isCloneEnabled) {
        updateClone();
      }
    }

    {
      // add input handlers
      // -----------------------------------------------------------------------
      getFromId("resize-original").onchange = updateResizeOriginal;
      getFromClass("focus-option").forEach((el) => (el.onchange = updateFocus));
      getFromClass("grid-option").forEach((el) => {
        el.addEventListener("change", updateGrid, false);
      });
      getFromTag("input").forEach((el) => (el.onclick = save));
      getFromId("commandsUrl").onclick = (event) => {
        void chrome.tabs.create({ url: (event.target as HTMLAnchorElement).href });
      };
      getFromClass("clone-mode-option").forEach((el) => {
        el.addEventListener(
          "change",
          () => {
            updateMaxDimensions();

            if (options.isCloneEnabled) {
              updateClone();
            }

            setWindowAsCurrent(getFromId("original"));
            updateResizeNew();
          },
          false,
        );
      });
    }
  };

  // Loading
  // ---------------------------------------------------------------------------

  const onReady = (action: () => void) => {
    if (document.readyState !== "loading") {
      action();
    } else {
      document.addEventListener("DOMContentLoaded", action);
    }
  };

  onReady(() => main());
});
