export const REQUEST_ADD_REMOTE_EVENT = 'memoria:add-remote-request'

export function requestAddRemote(): void {
  window.dispatchEvent(new Event(REQUEST_ADD_REMOTE_EVENT))
}
