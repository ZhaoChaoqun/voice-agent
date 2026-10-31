// Copyright (c) Microsoft. All rights reserved.
export function anchoredPopover(popup, anchor, { width, maxHeight = 560, onClose = () => {} } = {}) {
  const document = anchor.ownerDocument;
  const window = document.defaultView;
  let controller;
  let observer;
  popup.setAttribute("popover", "manual");

  const dispose = () => {
    controller?.abort();
    observer?.disconnect();
    controller = null;
    observer = null;
  };
  const hide = () => {
    dispose();
    if (popup.matches(":popover-open")) popup.hidePopover();
    popup.hidden = true;
    onClose();
  };
  const position = () => {
    if (!anchor.isConnected || !anchor.getClientRects().length) {
      hide();
      return;
    }
    const bounds = anchor.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight;
    const margin = 12;
    const gap = 8;
    if (bounds.bottom <= margin || bounds.top >= viewportHeight - margin) {
      hide();
      return;
    }
    Object.assign(popup.style, {
      position: "fixed",
      inset: "auto",
      margin: "0",
      boxSizing: "border-box",
      width: `${Math.min(width ?? bounds.width, viewportWidth - margin * 2)}px`,
      maxHeight: `${Math.min(maxHeight, viewportHeight - margin * 2)}px`,
    });
    const desiredHeight = popup.getBoundingClientRect().height;
    const below = Math.max(0, viewportHeight - bounds.bottom - gap - margin);
    const above = Math.max(0, bounds.top - gap - margin);
    const opensBelow = below >= desiredHeight || below >= above;
    popup.style.maxHeight = `${Math.min(maxHeight, opensBelow ? below : above)}px`;
    const size = popup.getBoundingClientRect();
    popup.style.left = `${Math.max(margin, Math.min(bounds.left, viewportWidth - size.width - margin))}px`;
    popup.style.top = `${Math.max(margin, opensBelow ? bounds.bottom + gap : bounds.top - gap - size.height)}px`;
  };
  const show = () => {
    popup.hidden = false;
    if (!popup.matches(":popover-open")) popup.showPopover();
    position();
    if (popup.hidden || controller) return;
    controller = new AbortController();
    window.addEventListener("resize", position, { signal: controller.signal });
    document.addEventListener("scroll", (event) => {
      if (!popup.contains(event.target)) position();
    }, { capture: true, passive: true, signal: controller.signal });
    observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) hide();
    });
    observer.observe(anchor);
  };
  return { show, hide, dispose };
}
