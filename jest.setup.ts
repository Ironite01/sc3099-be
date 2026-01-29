/**
 * Jest setup file for backend tests
 * Configures mocks for database, JWT, and other dependencies
 */

import { jest, beforeEach } from '@jest/globals';

// Reset mocks before each test
beforeEach(() => {
    jest.clearAllMocks();
});

// Global test timeout is set in jest.config.js
