import { routeStoredFileName } from '../utils/taskFileSync';

jest.mock('../db/database', () => ({ dbTaskAttachmentNames: jest.fn(() => []) }));
jest.mock('../utils/recipePhoto', () => ({}));
jest.mock('../utils/demoState', () => ({ isDemoModeActive: () => false }));

describe('routeStoredFileName', () => {
  it('sends a task file to the task folder and everything else to the recipe photos', () => {
    expect(routeStoredFileName('task-x.pdf')).toBe('task');
    expect(routeStoredFileName('abc123.jpg')).toBe('recipe');
    expect(routeStoredFileName('dish-abc.jpg')).toBe('dish');
  });
});
