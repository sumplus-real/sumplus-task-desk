import {refreshCatalogue} from '../src/catalogue.mjs';
const s=await refreshCatalogue();console.log(JSON.stringify({snapshotId:s.snapshotId,capturedAt:s.capturedAt,offers:s.offers.length,invalid:s.invalid.length}));
