import warning from 'tiny-warning';
import invariant from 'tiny-invariant';
import queryString from 'query-string';

import { createLocation } from './LocationUtils';
import {
  addLeadingSlash,
  stripTrailingSlash,
  hasBasename,
  stripBasename,
  createPath
} from './PathUtils';
import createTransitionManager from './createTransitionManager';
import {
  canUseDOM,
  getConfirmation,
  supportsHistory,
  supportsPopStateOnHashChange,
  isExtraneousPopstateEvent
} from './DOMUtils';

const PopStateEvent = 'popstate';
const HashChangeEvent = 'hashchange';

function pathToSearch(location, key) {
    // We put React-router path in search ?rounting=
    // and let the path as before.
    return {
      ...location,
      search: queryString.stringify({
        // Preserve other search keys.
        ...queryString.parse(window.location.search),
        [key]: location.pathname,
      }),
      pathname: window.location.pathname,
    };
  }
  
  function searchToPath(location, key) {
    const { search, hash } = location;
    const parsedSeach = queryString.parse(search);
    return {
      ...location,
      // We only use search, ignoring pathname.
      pathname: (parsedSeach[key] || '') + hash,
      // We preserve other search keys.
      search: queryString.stringify({
        ...parsedSeach,
        [key]: undefined,
      }),
    };
  }

function getHistoryState() {
  try {
    return window.history.state || {};
  } catch (e) {
    // IE 11 sometimes throws when accessing window.history.state
    // See https://github.com/ReactTraining/history/pull/289
    return {};
  }
}

/**
 * Creates a history object that uses the HTML5 history API including
 * pushState, replaceState, and the popstate event.
 */
function createBrowserHistory(props = {}) {
  invariant(canUseDOM, 'Browser history needs a DOM');

  const globalHistory = window.history;
  const canUseHistory = supportsHistory();
  const needsHashChangeListener = !supportsPopStateOnHashChange();

  const {
    forceRefresh = false,
    getUserConfirmation = getConfirmation,
    keyLength = 6
  } = props;
  const basename = props.basename
    ? stripTrailingSlash(addLeadingSlash(props.basename))
    : '';

  function getDOMLocation(historyState) {
    const { key, state } = historyState || {};
    const { hash } = window.location;

    // We only use search, ignoring pathname.
    const parsedLocation = searchToPath(window.location, searchKey);
    let path = parsedLocation.pathname + parsedLocation.search + hash;

    warning(
      !basename || hasBasename(path, basename),
      'You are attempting to use a basename on a page whose URL path does not begin ' +
        'with the basename. Expected path "' +
        path +
        '" to begin with "' +
        basename +
        '".'
    );

    if (basename) path = stripBasename(path, basename);

    return createLocation(path, state, key);
  }

  function createKey() {
    return Math.random()
      .toString(36)
      .substr(2, keyLength);
  }

  const transitionManager = createTransitionManager();

  function setState(nextState) {
    Object.assign(history, nextState);
    history.length = globalHistory.length;
    transitionManager.notifyListeners(history.location, history.action);
  }

  function handlePopState(event) {
    // Ignore extraneous popstate events in WebKit.
    if (isExtraneousPopstateEvent(event)) return;
    handlePop(getDOMLocation(event.state));
  }

  function handleHashChange() {
    handlePop(getDOMLocation(getHistoryState()));
  }

  let forceNextPop = false;

  function handlePop(location) {
    if (forceNextPop) {
      forceNextPop = false;
      setState();
    } else {
      const action = 'POP';

      transitionManager.confirmTransitionTo(
        location,
        action,
        getUserConfirmation,
        ok => {
          if (ok) {
            setState({ action, location });
          } else {
            revertPop(location);
          }
        }
      );
    }
  }

  function revertPop(fromLocation) {
    const toLocation = history.location;

    // TODO: We could probably make this more reliable by
    // keeping a list of keys we've seen in sessionStorage.
    // Instead, we just default to 0 for keys we don't know.

    let toIndex = allKeys.indexOf(toLocation.key);

    if (toIndex === -1) toIndex = 0;

    let fromIndex = allKeys.indexOf(fromLocation.key);

    if (fromIndex === -1) fromIndex = 0;

    const delta = toIndex - fromIndex;

    if (delta) {
      forceNextPop = true;
      go(delta);
    }
  }

  const initialLocation = getDOMLocation(getHistoryState());
  let allKeys = [initialLocation.key];

  // Public interface

  function createHref(location) {
    return basename + createPath(location);
  }

  function push(path, state) {
    warning(
      !(
        typeof path === 'object' &&
        path.state !== undefined &&
        state !== undefined
      ),
      'You should avoid providing a 2nd state argument to push when the 1st ' +
        'argument is a location-like object that already has state; it is ignored'
    );

    const action = 'PUSH';
    // We change location to have path data in a search parameter,
    // while interacting with global history object. (actual location displayed by browser)
    const location = pathToSearch(
        createLocation(path, state, createKey(), history.location),
        searchKey,
    );

    transitionManager.confirmTransitionTo(
      location,
      action,
      getUserConfirmation,
      ok => {
        if (!ok) return;

        const href = createHref(location);
        const { key, state } = location;

        if (canUseHistory) {
          globalHistory.pushState({ key, state }, null, href);

          if (forceRefresh) {
            window.location.href = href;
          } else {
            const prevIndex = allKeys.indexOf(history.location.key);
            const nextKeys = allKeys.slice(
              0,
              prevIndex === -1 ? 0 : prevIndex + 1
            );

            nextKeys.push(location.key);
            allKeys = nextKeys;

            // We change back location to have path data in pathname entry, as expected by React-Router,
            // so it can transparently do its routing.
            setState({ action, location: searchToPath(location, searchKey) });
          }
        } else {
          warning(
            state === undefined,
            'Browser history cannot push state in browsers that do not support HTML5 history'
          );

          window.location.href = href;
        }
      }
    );
  }

  function replace(path, state) {
    warning(
      !(
        typeof path === 'object' &&
        path.state !== undefined &&
        state !== undefined
      ),
      'You should avoid providing a 2nd state argument to replace when the 1st ' +
        'argument is a location-like object that already has state; it is ignored'
    );

    const action = 'REPLACE';
    // We change location to have path data in a search parameter,
    // while interacting with global history object. (actual location displayed by browser)
    const location = pathToSearch(
        createLocation(path, state, createKey(), history.location),
        searchKey,
    );

    transitionManager.confirmTransitionTo(
      location,
      action,
      getUserConfirmation,
      ok => {
        if (!ok) return;

        const href = createHref(location);
        const { key, state } = location;

        if (canUseHistory) {
          globalHistory.replaceState({ key, state }, null, href);

          if (forceRefresh) {
            window.location.replace(href);
          } else {
            const prevIndex = allKeys.indexOf(history.location.key);

            if (prevIndex !== -1) allKeys[prevIndex] = location.key;

            // We change back location to have path data in pathname entry, as expected by React-Router,
            // so it can transparently do its routing.
            setState({ action, location: searchToPath(location, searchKey) });
          }
        } else {
          warning(
            state === undefined,
            'Browser history cannot replace state in browsers that do not support HTML5 history'
          );

          window.location.replace(href);
        }
      }
    );
  }

  function go(n) {
    globalHistory.go(n);
  }

  function goBack() {
    go(-1);
  }

  function goForward() {
    go(1);
  }

  let listenerCount = 0;

  function checkDOMListeners(delta) {
    listenerCount += delta;

    if (listenerCount === 1 && delta === 1) {
      window.addEventListener(PopStateEvent, handlePopState);

      if (needsHashChangeListener)
        window.addEventListener(HashChangeEvent, handleHashChange);
    } else if (listenerCount === 0) {
      window.removeEventListener(PopStateEvent, handlePopState);

      if (needsHashChangeListener)
        window.removeEventListener(HashChangeEvent, handleHashChange);
    }
  }

  let isBlocked = false;

  function block(prompt = false) {
    const unblock = transitionManager.setPrompt(prompt);

    if (!isBlocked) {
      checkDOMListeners(1);
      isBlocked = true;
    }

    return () => {
      if (isBlocked) {
        isBlocked = false;
        checkDOMListeners(-1);
      }

      return unblock();
    };
  }

  function listen(listener) {
    const unlisten = transitionManager.appendListener(listener);
    checkDOMListeners(1);

    return () => {
      checkDOMListeners(-1);
      unlisten();
    };
  }

  const history = {
    length: globalHistory.length,
    action: 'POP',
    location: initialLocation,
    createHref,
    push,
    replace,
    go,
    goBack,
    goForward,
    block,
    listen
  };

  return history;
}

export default createBrowserHistory;
