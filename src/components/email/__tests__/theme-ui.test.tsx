import { afterEach, describe, expect, it, vi } from 'vitest';

import { BroadcastEditor } from '@/components/email/BroadcastEditor';
import { ThemePicker } from '@/components/email/ThemePicker';
import { ThemeSettingsPanels } from '@/components/email/ThemeSettingsPanels';
import { ThemeWarning } from '@/components/email/ThemeWarning';
import { PreviewDialog } from '@/components/email/PreviewDialog';
import { EmailApiError } from '@/components/email/email-api';
import { AdminHeaderContext } from '@/components/AdminScreenHeader';
import {
  DEFAULT_THEME_TOKENS,
  THEME_PRESETS,
  getThemePreset,
  type CustomTheme,
} from '@/lib/email/themes';
import { all, byName, click, flush, mount, need, text, type as typeInto, unmount } from './dom';
import { SETTINGS, broadcast, fakeApi, overview } from './fixtures';

/**
 * The theme UI: picking a look, fine-tuning its tokens, saving it as the
 * ministry's own theme, making it the default, the loud cap-10 error, and the
 * contrast warning. Plus one planted-defect check, in the house style: the
 * selection probe is proven able to fail before it is trusted.
 */

afterEach(async () => {
  await unmount();
  vi.restoreAllMocks();
});

const letter = getThemePreset('letter')!.tokens;
const checkBadge = (tile: HTMLElement) => tile.querySelector('.lucide-check');

describe('PreviewDialog starting mode and React 18 close composition', () => {
  it.each(['computer', 'phone', 'dark'] as const)('starts in %s without clicking a mode control', async (mode) => {
    const preview = vi.fn(async () => '<p>Sample email</p>');
    await mount(<PreviewDialog open onOpenChange={() => {}} api={{ preview }} draft={{ subject: 'Sunday' }} initialMode={mode} />);
    await flush();

    const label = { computer: 'Computer', phone: 'Phone', dark: 'Dark' }[mode];
    expect(need(byName('button', label), 'initial mode').getAttribute('aria-pressed')).toBe('true');
    expect(preview).toHaveBeenCalledWith({ subject: 'Sunday', dark: mode === 'dark' });
    expect(document.querySelector('iframe')?.getAttribute('srcdoc')).toBe('<p>Sample email</p>');
  });

  it('closes through a native render button without a function-component ref warning', async () => {
    const errors = vi.spyOn(console, 'error');
    const onOpenChange = vi.fn();
    await mount(<PreviewDialog open onOpenChange={onOpenChange} api={{ preview: async () => '<p>Preview</p>' }} draft={{}} />);
    await flush();
    await click(need(byName('button', 'Close'), 'close preview'));

    expect(onOpenChange.mock.calls[0]?.[0]).toBe(false);
    expect(errors.mock.calls.filter((args) => args.some((arg) => String(arg).includes('Function components cannot be given refs')))).toEqual([]);
  });
});

describe('ThemePicker', () => {
  it('draws the five presets and marks the selected one with a check on that tile alone', async () => {
    await mount(<ThemePicker selectedId="letter" onSelect={() => {}} />);
    const tiles = all('[role=radio]');
    expect(tiles.map((t) => t.getAttribute('aria-label'))).toEqual(THEME_PRESETS.map((p) => p.name));
    const picked = need(byName('[role=radio]', 'Letter'), 'letter tile');
    expect(picked.getAttribute('aria-checked')).toBe('true');
    expect(checkBadge(picked)).not.toBeNull();
    for (const t of tiles.filter((x) => x !== picked)) {
      expect(t.getAttribute('aria-checked')).toBe('false');
      expect(checkBadge(t)).toBeNull();
    }
  });

  it('clicking a tile hands its id and its own preset tokens back', async () => {
    const onSelect = vi.fn();
    await mount(<ThemePicker selectedId={null} onSelect={onSelect} />);
    await click(need(byName('[role=radio]', 'Midnight'), 'midnight'));
    expect(onSelect).toHaveBeenCalledWith({ id: 'midnight', tokens: getThemePreset('midnight')!.tokens });
  });

  it('saved themes sit after the presets, and only the default tile says Default', async () => {
    const customs: CustomTheme[] = [
      { id: 'c1', name: 'Sunday letter', tokens: letter, createdAt: '2031-01-01T00:00:00.000Z' },
      { id: 'c2', name: 'Advent', tokens: letter, createdAt: '2031-01-02T00:00:00.000Z' },
    ];
    await mount(<ThemePicker selectedId="c1" defaultId="c2" onSelect={() => {}} customThemes={customs} />);
    const tiles = all('[role=radio]');
    expect(tiles.map((t) => t.getAttribute('aria-label'))).toEqual([...THEME_PRESETS.map((p) => p.name), 'Sunday letter', 'Advent']);
    expect(need(byName('[role=radio]', 'Advent'), 'advent').textContent).toContain('Default');
    expect(need(byName('[role=radio]', 'Sunday letter'), 'sunday').textContent).not.toContain('Default');
  });

  it('the checkmark probe can fail: a badge on an unselected tile is caught (planted defect)', async () => {
    await mount(<ThemePicker selectedId="letter" onSelect={() => {}} />);
    // The probe under test: a tile agrees with itself only when its checked
    // state and its badge say the same thing.
    const mismatched = () => all('[role=radio]').filter((t) => (t.getAttribute('aria-checked') === 'true') !== Boolean(checkBadge(t)));
    expect(mismatched(), 'a clean picker agrees with itself').toEqual([]);
    // Plant the defect this guard exists for: the badge lands on a tile nobody picked.
    const essay = need(byName('[role=radio]', 'Essay'), 'essay');
    essay.insertBefore(need(document.querySelector('.lucide-check')!.parentElement, 'badge'), essay.firstChild);
    expect(mismatched().map((t) => t.getAttribute('aria-label'))).toEqual(['Letter', 'Essay']);
  });
});

describe('the settings panels write through to the tokens', () => {
  it('typing a hex into a colour row updates that token and nothing else', async () => {
    const onChange = vi.fn();
    await mount(<ThemeSettingsPanels tokens={letter} onChange={onChange} defaults={letter} />);
    await typeInto(need(byName('input', 'Headings hex'), 'heading hex'), '#123456');
    expect(onChange).toHaveBeenLastCalledWith({ ...letter, heading: '#123456' });
  });

  it('a segmented choice in another section updates its own field', async () => {
    const onChange = vi.fn();
    await mount(<ThemeSettingsPanels tokens={letter} onChange={onChange} defaults={letter} />);
    await click(need(byName('button', /Fonts and text size/), 'fonts section'));
    await click(need(byName('button', 'Large'), 'large text'));
    expect(onChange).toHaveBeenLastCalledWith({ ...letter, textSize: 'large' });
  });

  it('Reset restores the section from the defaults the writer started from, never a hardcoded palette', async () => {
    const onChange = vi.fn();
    const start = { ...letter, heading: '#123456' };
    await mount(<ThemeSettingsPanels tokens={start} onChange={onChange} defaults={letter} />);
    await click(need(byName('button', /^Reset colours$/), 'reset'));
    expect(onChange).toHaveBeenLastCalledWith({ ...start, page: letter.page, card: letter.card, text: letter.text, heading: letter.heading, accent: letter.accent });
  });
});

describe('ThemeWarning', () => {
  const low = { ...DEFAULT_THEME_TOKENS, page: '#FFFFFF', card: '#FFFFFF', text: '#F2F2F2', heading: '#EFEFEF' };

  it('appears for a low-contrast theme and says the words were adjusted when they were', async () => {
    await mount(<ThemeWarning tokens={low} />);
    expect(text()).toContain('Some colours may be hard to read');
    expect(text()).toContain('We adjusted the words so they stay readable');
  });

  it('draws nothing for a healthy theme, and nothing for the classic look', async () => {
    await mount(<ThemeWarning tokens={getThemePreset('letter')!.tokens} />);
    expect(text()).not.toContain('hard to read');
    await unmount();
    await mount(<ThemeWarning tokens={null} />);
    expect(text()).not.toContain('hard to read');
  });
});


const headerApi = {
  setHeaderAction: () => {},
  setHeaderHidden: () => {},
  setNavHidden: () => {},
  setHeaderOverride: () => {},
};
const inShell = (ui: React.ReactElement) => <AdminHeaderContext.Provider value={headerApi}>{ui}</AdminHeaderContext.Provider>;

/** The real editor, opened on the Letter theme, with its design dialog up. */
async function openDesign(api: ReturnType<typeof fakeApi>) {
  await mount(inShell(
    <BroadcastEditor
      api={api}
      data={overview()}
      initial={broadcast({ themeId: 'letter', themeTokens: letter })}
      onBack={() => {}}
      onOpenSettings={() => {}}
      onChanged={() => {}}
      onOpen={() => {}}
    />,
  ));
  await flush();
  await click(need(byName('button', /\(current look\)/), 'design button'));
  await flush();
}

describe('Save as my theme and Make it my default, through the real editor', () => {
  it('the name dialog hands the name and the current token snapshot to the api', async () => {
    const api = fakeApi();
    await openDesign(api);
    await click(need(byName('button', 'Save as my theme'), 'save as my theme'));
    await typeInto(need(document.querySelector<HTMLInputElement>('#saved-theme-name'), 'theme name'), 'Sunday letter');
    await click(need(byName('button', 'Save theme'), 'save theme'));
    await flush();
    expect(api.saveTheme).toHaveBeenCalledWith({ name: 'Sunday letter', tokens: letter });
  });

  it('Make it my default calls the api with the applied theme', async () => {
    const api = fakeApi();
    await openDesign(api);
    await click(need(byName('button', 'Make it my default'), 'make default'));
    await flush();
    expect(api.setDefaultTheme).toHaveBeenCalledWith('letter');
  });

  it('the eleventh theme is refused loudly and the name dialog stays open (cap 10)', async () => {
    const api = fakeApi({
      saveTheme: vi.fn(async () => {
        throw new EmailApiError('You can save up to 10 themes. Delete one you do not use to make room for another.', 'theme_limit', false);
      }),
    });
    await openDesign(api);
    await click(need(byName('button', 'Save as my theme'), 'save as my theme'));
    await typeInto(need(document.querySelector<HTMLInputElement>('#saved-theme-name'), 'theme name'), 'One too many');
    await click(need(byName('button', 'Save theme'), 'save theme'));
    await flush();
    expect(text()).toContain('You can save up to 10 themes');
    expect(document.querySelector('#saved-theme-name'), 'the name dialog stays open on the error').not.toBeNull();
  });

  it('a pick in the picker hands the preset tokens to the editor as a fresh snapshot', async () => {
    const api = fakeApi();
    await openDesign(api);
    await click(need(byName('[role=radio]', 'Card'), 'card preset'));
    await flush();
    // The editor snapshots the pick: saving the draft now carries Card's tokens.
    await click(need(byName('button', 'Save as my theme'), 'save as my theme'));
    await typeInto(need(document.querySelector<HTMLInputElement>('#saved-theme-name'), 'theme name'), 'Card copy');
    await click(need(byName('button', 'Save theme'), 'save theme'));
    await flush();
    expect(api.saveTheme).toHaveBeenCalledWith({ name: 'Card copy', tokens: getThemePreset('card')!.tokens });
  });
});

