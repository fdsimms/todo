import { appLinks, appSiteAssociation, appUrlForOpenPath, openPage, OPEN_PATHS } from '../appLinks';
import { appUrlFromUniversalLink, UNIVERSAL_LINK_HOSTS } from '../../../src/utils/deepLinks';

jest.mock('react-native', () => ({ Linking: {} }));
jest.mock('../../../src/utils/demoHold', () => ({ runOrHoldForDemo: (fn: () => void) => fn() }));
jest.mock('../../../src/navigation/navigationRef', () => ({}));
jest.mock('../../../src/store/useTaskStore', () => ({ useTaskStore: {} }));
jest.mock('../../../src/store/useRecipeStore', () => ({ useRecipeStore: {} }));
jest.mock('../../../src/store/useMealPlanStore', () => ({ useMealPlanStore: {} }));
jest.mock('../../../src/store/useStepTimerStore', () => ({ useStepTimerStore: {} }));
jest.mock('../../../src/store/useFocusStore', () => ({ useFocusStore: {} }));
jest.mock('../../../src/store/useWidgetCompletionStore', () => ({ useWidgetCompletionStore: {} }));
jest.mock('../../../src/utils/haptics', () => ({ haptics: {} }));

const links = appLinks('https://dundundun-mcp.fly.dev/mcp')!;

describe('appLinks', () => {
  it('builds /open/ links on the server\'s own origin', () => {
    expect(links.task('t 1')).toBe('https://dundundun-mcp.fly.dev/open/task?id=t+1');
    expect(links.project('p1')).toBe('https://dundundun-mcp.fly.dev/open/project?id=p1');
    expect(links.groceries()).toBe('https://dundundun-mcp.fly.dev/open/groceries');
    expect(links.mealPlan('2026-10-05')).toBe('https://dundundun-mcp.fly.dev/open/mealplan?date=2026-10-05');
    expect(links.person('x')).toBe('https://dundundun-mcp.fly.dev/open/people?person=x');
  });

  it('is off without a public address', () => {
    expect(appLinks(undefined)).toBeNull();
    expect(appLinks('not a url')).toBeNull();
  });

  // The two halves have to agree: every link the server hands out has to be one
  // the app turns back into its own link, on a host it is associated with.
  it('hands out only links the app will open', () => {
    expect(UNIVERSAL_LINK_HOSTS).toContain('dundundun-mcp.fly.dev');
    for (const href of [links.task('t1'), links.project('p1'), links.groceries(), links.pantry(), links.recipe('r1'), links.mealPlan('2026-10-05'), links.person('x')]) {
      expect(appUrlFromUniversalLink(href)).toMatch(/^dundundun:\/\//);
    }
  });
});

describe('appUrlForOpenPath', () => {
  it('maps a known path and its query onto the app scheme', () => {
    expect(appUrlForOpenPath('task', '?id=t1')).toBe('dundundun://task?id=t1');
    expect(appUrlForOpenPath('/groceries/', '')).toBe('dundundun://groceries');
  });

  it('refuses anything the app has no screen for', () => {
    expect(appUrlForOpenPath('add', '?title=x')).toBeNull();
    expect(appUrlForOpenPath('javascript:alert(1)', '')).toBeNull();
    expect(OPEN_PATHS).not.toContain('add');
  });
});

describe('appSiteAssociation', () => {
  it('names the app by team and bundle id, for /open/ only', () => {
    expect(appSiteAssociation('ABCDE12345', 'com.fdsimms.dundundun')).toEqual({
      applinks: { details: [{ appIDs: ['ABCDE12345.com.fdsimms.dundundun'], components: [expect.objectContaining({ '/': '/open/*' })] }] },
    });
    expect(appSiteAssociation(undefined, 'com.fdsimms.dundundun')).toBeNull();
  });
});

describe('openPage', () => {
  it('cannot be broken out of by a crafted query', () => {
    const html = openPage('dundundun://task?id=</script><script>alert(1)</script>');
    expect(html).not.toContain('</script><script>alert');
    expect(html).toContain('\\u003c/script>');
  });
});
