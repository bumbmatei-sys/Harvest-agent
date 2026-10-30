/**
 * user-event's host hooks, for tests that use our own React DOM mount helper.
 * The pinned install uses legacy-peer-deps and does not include the DOM query
 * library that normally supplies these hooks. user-event only imports getConfig
 * from it. Keep its real keyboard, pointer and input behavior; the tests wrap
 * interactions in React act themselves. Every callback and error still escapes.
 */
export function getConfig() {
  return {
    eventWrapper: <T>(callback: () => T): T => callback(),
    asyncWrapper: <T>(callback: () => Promise<T>): Promise<T> => callback(),
    getElementError: (message: string): Error => new Error(message),
  };
}
