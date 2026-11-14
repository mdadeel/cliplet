// Resolve `gi://X` (gjs-only) to the local stub so the real extension
// modules can be imported under Node.
import { fileURLToPath, pathToFileURL } from 'node:url';
const stub = pathToFileURL(fileURLToPath(new URL('./gi-stub.mjs', import.meta.url))).href;
export async function resolve(specifier, context, next) {
    if (specifier.startsWith('gi://'))
        return { url: stub, shortCircuit: true };
    if (specifier.startsWith('resource:///'))
        throw new Error(`shell-only import in a pure module: ${specifier}`);
    return next(specifier, context);
}
