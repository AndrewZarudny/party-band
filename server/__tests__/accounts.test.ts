// The accounts API on the JSON files (no FRETWISE_DB_URL): the shared cases in accounts-suite.ts.
import fs from 'node:fs'
import path from 'node:path'
import { accountsSuite } from './accounts-suite'

accountsSuite('accounts on JSON files', {
  stored: async (app) => fs.readFileSync(path.join(app.dir, 'accounts.json'), 'utf8'),
})
