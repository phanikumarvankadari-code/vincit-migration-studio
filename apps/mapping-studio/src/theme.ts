import { createLightTheme, type BrandVariants, type Theme } from '@fluentui/react-components';

/** Vincit Migration Studio: a light theme with one deep-blue accent. */
const brand: BrandVariants = {
  10: '#020612',
  20: '#0B1230',
  30: '#10194A',
  40: '#142160',
  50: '#172A74',
  60: '#1A3081',
  70: '#1C3686',
  80: '#1F3A8A',
  90: '#33499A',
  100: '#4859A8',
  110: '#5C6BB5',
  120: '#717EC1',
  130: '#8691CC',
  140: '#9CA5D7',
  150: '#B2B9E1',
  160: '#C9CEEB',
};

export const vincitTheme: Theme = {
  ...createLightTheme(brand),
  colorNeutralBackground2: '#fafbf5',
  colorNeutralBackground3: '#f4f6ee',
};
