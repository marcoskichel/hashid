import { defineConfig } from 'eslint/config';

import base from '@hashid/eslint-config/base';
import neverthrow from '@hashid/eslint-config/neverthrow';

export default defineConfig([...base, ...neverthrow]);
