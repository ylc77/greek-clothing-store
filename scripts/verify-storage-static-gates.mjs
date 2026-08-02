import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const imagesRoute = read("app/api/admin/images/route.ts");
const settingsRoute = read("app/api/admin/settings/upload/route.ts");
const styleRoute = read("app/api/admin/products/style-image/route.ts");
const permanentRoute = read("app/api/admin/products/[id]/permanent/route.ts");
const validation = read("lib/image-security.ts");
const secureFetch = read("lib/secure-image-fetch.ts");
const lifecycle = read("lib/storage-lifecycle.ts");
const maintenance = read("scripts/storage-maintenance.ts");

assert.match(validation, /detectImageFormat/);
assert.match(validation, /limitInputPixels/);
assert.match(validation, /MIME_MISMATCH/);
assert.match(validation, /PIXEL_LIMIT_EXCEEDED/);
assert.match(validation, /\.webp\(/);
assert.doesNotMatch(validation, /return\s+\{\s*buffer:\s*input/);

assert.match(settingsRoute, /allowedTargets\s*=\s*new Set\(\["logo", "hero", "category"\]/);
assert.match(settingsRoute, /optimizeImageFile/);
assert.match(settingsRoute, /uploadAndCommitStorageObject/);
assert.match(settingsRoute, /queueStorageObjectDeletion/);
assert.doesNotMatch(settingsRoute, /file\.type\.startsWith\("image\/"\)/);
assert.doesNotMatch(settingsRoute, /use original|Buffer\.from\(await file\.arrayBuffer\(\)\).*catch/s);
assert.doesNotMatch(settingsRoute, /createBucket|updateBucket/);

assert.match(imagesRoute, /productStoragePath/);
assert.match(imagesRoute, /pathBelongsToProduct/);
assert.match(imagesRoute, /uploadAndCommitStorageObject/);
assert.match(imagesRoute, /detachAndDeleteStorageObject/);
assert.match(imagesRoute, /PRODUCT_IMAGE_WIDTH = 1200/);
assert.match(imagesRoute, /PRODUCT_IMAGE_HEIGHT = 1600/);
assert.match(imagesRoute, /fit: "cover"/);
assert.doesNotMatch(imagesRoute, /\.upload\(/);
assert.doesNotMatch(imagesRoute, /storagePathFor\(/);

assert.match(styleRoute, /downloadRemoteImage/);
assert.match(styleRoute, /SERVER_IMAGE_FETCH_ALLOWED_ORIGINS/);
assert.match(styleRoute, /uploadAndCommitStorageObject/);
assert.match(styleRoute, /generationSize/);
assert.match(styleRoute, /outputWidth = 1024/);
assert.match(styleRoute, /outputHeight = 1365/);
assert.match(styleRoute, /vertical 3:4 portrait/);
assert.doesNotMatch(styleRoute, /fetch\(url/);
assert.doesNotMatch(styleRoute, /response\.arrayBuffer\(\)/);
assert.doesNotMatch(styleRoute, /\.upload\(/);

assert.match(secureFetch, /dnsLookup/);
assert.match(secureFetch, /BlockList/);
assert.match(secureFetch, /lookup:\s*\(_hostname, _options, callback\) => callback\(null, address, family\)/);
assert.match(secureFetch, /\[301, 302, 303, 307, 308\]/);
assert.match(secureFetch, /content-length/);
assert.match(secureFetch, /total > maxBytes/);
assert.match(secureFetch, /PRIVATE_NETWORK_BLOCKED/);

assert.match(lifecycle, /storage_object_operations/);
assert.match(lifecycle, /cleanup_pending/);
assert.match(lifecycle, /compensated/);
assert.match(permanentRoute, /product_permanent_delete_prepare_rpc/);
assert.match(permanentRoute, /completePreparedStorageDeletion/);
assert.doesNotMatch(permanentRoute, /\.from\("products"\)\.delete/);
assert.doesNotMatch(permanentRoute, /non-blocking/);

assert.match(maintenance, /mode:\s*"read-only"/);
assert.match(maintenance, /mutated:\s*report\.mutated/);
assert.match(maintenance, /storage:reconcile|reconcileStorageInventory/);

console.log("Storage/image static gates passed.");
