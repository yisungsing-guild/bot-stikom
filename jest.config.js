module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  moduleFileExtensions: ['js', 'json'],
  resetModules: true,
  setupFilesAfterEnv: ['<rootDir>/tests/jest.setup.js'],
};
