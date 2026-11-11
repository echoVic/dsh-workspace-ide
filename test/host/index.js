/**
 * Directory entry point for the Host test suite.
 *
 * Node >= 22 removed directory arguments from `node --test`, so the contracted
 * `node --test test/host/` form resolves this directory as a single test file.
 * Importing every suite here keeps that exact verification command working;
 * `node --test 'test/host/*.test.mjs'` runs the same suites directly.
 *
 * @module dsh-workspace-ide/test/host
 */

import './respond.test.mjs';
import './paths.test.mjs';
import './files.test.mjs';
import './list.test.mjs';
import './file.test.mjs';
import './image.test.mjs';
import './search.test.mjs';
import './git.test.mjs';
import './routes.test.mjs';
