import fs from 'node:fs';
import path from 'node:path';
import colors from '../constants/colors';
import { computePremiumHomeHeroMetrics, computePremiumPosterGridMetrics } from '../lib/design/layoutMetrics';
import { resolvePremiumScreenProfile } from '../lib/design/screenProfiles';
import { premiumDesignTokens } from '../lib/design/tokens';

type Scenario = {
  name: string;
  run: () => void;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertFinitePositive(value: number, label: string): void {
  assert(Number.isFinite(value) && value > 0, `${label} must be a positive finite number`);
}

const portrait = resolvePremiumScreenProfile({
  mode: 'mobilePortrait',
  width: 390,
  height: 844,
  density: 3,
  navState: 'closed',
});

const landscape = resolvePremiumScreenProfile({
  mode: 'mobileLandscape',
  width: 926,
  height: 428,
  density: 3,
  navState: 'closed',
});

const scenarios: Scenario[] = [
  {
    name: 'tokens bridge the existing semantic color system',
    run: () => {
      assert(premiumDesignTokens.colors.primary === colors.dark.primary, 'primary color must come from constants/colors');
      assert(premiumDesignTokens.colors.background === colors.dark.background, 'background color must come from constants/colors');
      assert(premiumDesignTokens.radius.sm === colors.radius, 'base radius must stay linked to constants/colors');
    },
  },
  {
    name: 'invalid screen dimensions fall back safely',
    run: () => {
      const profile = resolvePremiumScreenProfile({ mode: 'mobilePortrait', width: 0, height: Number.NaN });
      assert(profile.width === 390, 'portrait width fallback must be used');
      assert(profile.height === 844, 'portrait height fallback must be used');
      assertFinitePositive(profile.effectiveContentWidth, 'effective content width');
      assertFinitePositive(profile.effectiveContentHeight, 'effective content height');
    },
  },
  {
    name: 'mobile portrait keeps readable poster density',
    run: () => {
      const grid = computePremiumPosterGridMetrics(portrait);
      assert(grid.columns === 2, `portrait should keep two columns, got ${grid.columns}`);
      assert(grid.posterWidth >= premiumDesignTokens.poster.minWidth.mobilePortrait, 'portrait posters must stay readable');
    },
  },
  {
    name: 'mobile landscape increases poster density',
    run: () => {
      const portraitGrid = computePremiumPosterGridMetrics(portrait);
      const landscapeGrid = computePremiumPosterGridMetrics(landscape);
      assert(landscapeGrid.columns > portraitGrid.columns, 'landscape must show more columns than portrait');
      assert(landscapeGrid.posterWidth <= portraitGrid.posterWidth, 'landscape posters must not become larger than portrait posters');
    },
  },
  {
    name: 'tiny landscape devices retain valid tap and poster metrics',
    run: () => {
      const smallLandscape = resolvePremiumScreenProfile({
        mode: 'mobileLandscape',
        width: 640,
        height: 320,
        density: 2.75,
        navState: 'open',
      });
      const grid = computePremiumPosterGridMetrics(smallLandscape);
      assert(grid.columns >= 4, 'small landscape should still use compact multi-column density');
      assertFinitePositive(grid.posterWidth, 'small landscape poster width');
      assert(premiumDesignTokens.touchTarget.minimum >= 44, 'touch targets must not drop below 44dp');
    },
  },
  {
    name: 'safe area insets reduce usable layout space',
    run: () => {
      const withoutInsets = resolvePremiumScreenProfile({ mode: 'mobileLandscape', width: 926, height: 428 });
      const withInsets = resolvePremiumScreenProfile({
        mode: 'mobileLandscape',
        width: 926,
        height: 428,
        safeArea: { left: 28, right: 28, bottom: 18 },
      });
      assert(withInsets.effectiveContentWidth < withoutInsets.effectiveContentWidth, 'safe area must reduce content width');
      assert(withInsets.effectiveContentHeight < withoutInsets.effectiveContentHeight, 'safe area must reduce content height');
    },
  },
  {
    name: 'open navigation reduces available vertical content without resetting profile',
    run: () => {
      const closed = resolvePremiumScreenProfile({ mode: 'mobileLandscape', width: 926, height: 428, navState: 'closed' });
      const open = resolvePremiumScreenProfile({ mode: 'mobileLandscape', width: 926, height: 428, navState: 'open' });
      assert(open.effectiveContentWidth === closed.effectiveContentWidth, 'nav state must not change horizontal content width');
      assert(open.effectiveContentHeight < closed.effectiveContentHeight, 'open nav must reserve vertical chrome height');
    },
  },
  {
    name: 'landscape hero is height-bound and compact',
    run: () => {
      const hero = computePremiumHomeHeroMetrics(landscape);
      assert(hero.compact, 'landscape hero must be marked compact');
      assert(hero.height <= premiumDesignTokens.hero.maxHeight.mobileLandscape, 'landscape hero must respect max height');
      assert(hero.height <= Math.ceil(landscape.effectiveContentHeight * premiumDesignTokens.hero.heightFraction.mobileLandscape), 'landscape hero must be bound by usable height');
    },
  },
  {
    name: 'portrait hero remains cinematic but title-limited',
    run: () => {
      const hero = computePremiumHomeHeroMetrics(portrait);
      assert(!hero.compact, 'portrait hero should not use landscape compact mode');
      assert(hero.height >= premiumDesignTokens.hero.minHeight.mobilePortrait, 'portrait hero must stay readable');
      assert(hero.maxTitleLines === 2, 'hero titles must be limited to two lines');
    },
  },
  {
    name: 'tv profile uses separate overscan and grid scale',
    run: () => {
      const tv = resolvePremiumScreenProfile({ mode: 'tv', width: 1920, height: 1080, density: 1, navState: 'closed' });
      const tvGrid = computePremiumPosterGridMetrics(tv);
      assert(tv.navState === 'open', 'tv navigation chrome must remain visible');
      assert(tv.effectiveContentWidth < 1920 - premiumDesignTokens.contentPadding.horizontal.tv * 2, 'tv overscan must reduce content width');
      assert(tvGrid.columns >= premiumDesignTokens.poster.minColumns.tv, 'tv grid must use tv column bounds');
      assert(tvGrid.posterWidth >= premiumDesignTokens.poster.minWidth.tv, 'tv posters must use tv sizing, not mobile landscape sizing');
    },
  },
  {
    name: 'hero metrics respond to navigation chrome height',
    run: () => {
      const closed = computePremiumHomeHeroMetrics(
        resolvePremiumScreenProfile({ mode: 'mobileLandscape', width: 926, height: 428, navState: 'closed' }),
      );
      const open = computePremiumHomeHeroMetrics(
        resolvePremiumScreenProfile({ mode: 'mobileLandscape', width: 926, height: 428, navState: 'open' }),
      );
      assert(open.height <= closed.height, 'open nav should not create a taller hero');
    },
  },
  {
    name: 'design foundation does not depend on provider or playback layers',
    run: () => {
      const designDir = path.resolve(__dirname, '../lib/design');
      const designSource = fs
        .readdirSync(designDir)
        .filter((file) => file.endsWith('.ts'))
        .map((file) => fs.readFileSync(path.join(designDir, file), 'utf8'))
        .join('\n');
      const forbidden = ['LibVLC', 'playbackUrl', 'Xtream', 'Stalker', 'M3U', 'credential', 'auth'];
      const leaked = forbidden.filter((term) => designSource.includes(term));
      assert(leaked.length === 0, `design modules must stay protocol-free, found: ${leaked.join(', ')}`);
    },
  },
];

let passed = 0;

for (const scenario of scenarios) {
  scenario.run();
  passed += 1;
}

console.log(`premium design system scenarios: ${passed}/${scenarios.length} passed`);
