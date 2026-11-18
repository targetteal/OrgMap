/** jsdom has dialog elements but does not implement their modal lifecycle. */
export function installDialogLifecycle(window: {HTMLDialogElement: {prototype: HTMLDialogElement}}) {
  const prototype = window.HTMLDialogElement.prototype;
  prototype.showModal = function () { this.setAttribute('open', ''); };
  prototype.close = function () { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); };
}
