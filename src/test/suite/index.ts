import * as fs from 'fs';
import * as path from 'path';
import Mocha from 'mocha';

export function run(): Promise<void> {
    const mocha = new Mocha({
        ui: 'tdd',
        color: true,
        timeout: 120000
    });
    const testsRoot = __dirname;

    return new Promise((resolve: any, reject: any) => {
        try {
            for (const file of findTestFiles(testsRoot)) {
                mocha.addFile(file);
            }

            mocha.run((failures: any) => {
                if (failures > 0) {
                    reject(new Error(`${failures} test(s) failed.`));
                    return;
                }

                resolve();
            });
        } catch (error) {
            reject(error);
        }
    });
}

function findTestFiles(root: string): string[] {
    const files: string[] = [];
    const stack = [root];

    while (stack.length > 0) {
        const current = stack.pop()!;
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(fullPath);
                continue;
            }

            if (entry.isFile() && entry.name.endsWith('.test.js')) {
                files.push(fullPath);
            }
        }
    }

    return files.sort((left: any, right: any) => left.localeCompare(right));
}
