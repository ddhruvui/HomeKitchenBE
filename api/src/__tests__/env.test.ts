import { resolveDbName, resolveMongoUri } from '../env';

describe('database selection', () => {
  test('defaults to the test database', () => { expect(resolveDbName({})).toBe('HomeKitchenTest'); });
  test('USE_TEST_DB=true is the test database', () => { expect(resolveDbName({ USE_TEST_DB: 'true', DB_NAME: 'HomeKitchen' })).toBe('HomeKitchenTest'); });
  test('only an explicit false reaches production', () => {
    expect(resolveDbName({ USE_TEST_DB: 'false', DB_NAME: 'HomeKitchen' })).toBe('HomeKitchen');
    expect(resolveDbName({ USE_TEST_DB: 'FALSE' })).toBe('HomeKitchen');
    expect(resolveDbName({ USE_TEST_DB: 'yes', DB_NAME: 'HomeKitchen' })).toBe('HomeKitchenTest');
  });
  test('test database name can be overridden', () => { expect(resolveDbName({ TEST_DB_NAME: 'Scratch' })).toBe('Scratch'); });
  test('password is substituted and URL-encoded', () => {
    expect(resolveMongoUri({ MONGODB_URI: 'mongodb+srv://u:<db_password>@h/?x=1', DB_PASSWORD: 'p@ss word' })).toBe('mongodb+srv://u:p%40ss%20word@h/?x=1');
    expect(() => resolveMongoUri({})).toThrow(/MONGODB_URI/);
  });
});
