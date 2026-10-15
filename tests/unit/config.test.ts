import { databaseName } from '../../src/config';

describe('databaseName', () => {
  it('uses the real database only for the live app', () => {
    expect(databaseName('live')).toBe('rental-tracker');
  });

  it('keeps preview and development builds away from real data', () => {
    expect(databaseName('preview')).toBe('rental-tracker-preview');
    expect(databaseName('dev')).toBe('rental-tracker-preview');
    expect(databaseName('preview')).not.toBe(databaseName('live'));
  });
});
