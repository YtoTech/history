'use strict';

import warnAboutDeprecatedESMImport from './warnAboutDeprecatedESMImport.js';
warnAboutDeprecatedESMImport('createSearchHistory');

import { createSearchHistory } from '../esm/history.js';
export default createSearchHistory;
