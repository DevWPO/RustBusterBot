const DOCK_ID = 'ib-floating-dock';

const ensureBody = () => {
    if (!document.body) {
        throw new Error('Document body not ready for IdentifierBuster dock.');
    }
    return document.body;
};

export const ensureDock = () => {
    let dock = document.getElementById(DOCK_ID);
    if (dock) return dock;

    dock = document.createElement('section');
    dock.id = DOCK_ID;
    dock.setAttribute('role', 'complementary');
    dock.setAttribute('aria-label', 'IdentifierBuster overlays');

    ensureBody().appendChild(dock);
    return dock;
};

export const attachPanel = (panel, { position = 'bottom' } = {}) => {
    const dock = ensureDock();
    const alreadyMounted = panel.parentElement === dock;

    if (position === 'top') {
        if (!alreadyMounted || dock.firstElementChild !== panel) {
            dock.prepend(panel);
        }
    } else if (!alreadyMounted || dock.lastElementChild !== panel) {
        dock.appendChild(panel);
    }

    return panel;
};
