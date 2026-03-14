import * as assert from 'assert/strict';
import {
    getClusterWorkModePresets,
    resolveClusterWorkModePreset
} from '../../config/clusterWorkModes';

suite('clusterWorkModes', () => {
    test('ships member blueprints for every swarm preset', () => {
        const presets = getClusterWorkModePresets();
        assert.ok(presets.length > 0, 'expected cluster presets to exist');

        presets.forEach(preset => {
            assert.ok(Array.isArray(preset.memberBlueprints), `expected ${preset.id} to expose member blueprints`);
            assert.ok(preset.memberBlueprints.length >= 3, `expected ${preset.id} to define at least three member lanes`);
            assert.ok(
                preset.memberBlueprints.some(blueprint => blueprint.isCoordinator),
                `expected ${preset.id} to define a coordinator lane`
            );

            preset.memberBlueprints.forEach(blueprint => {
                assert.ok(blueprint.id, `expected blueprint id in ${preset.id}`);
                assert.ok(blueprint.title, `expected blueprint title in ${preset.id}`);
                assert.ok(blueprint.identity, `expected blueprint identity in ${preset.id}`);
                assert.ok(blueprint.stance, `expected blueprint stance in ${preset.id}`);
            });
        });
    });

    test('returns cloned member blueprints so callers cannot mutate preset definitions', () => {
        const preset = resolveClusterWorkModePreset('implementation-squad');
        const firstBlueprint = preset.memberBlueprints[0];
        assert.ok(firstBlueprint, 'expected implementation-squad to have blueprints');

        firstBlueprint.title = 'Mutated title';
        const reloadedPreset = resolveClusterWorkModePreset('implementation-squad');
        assert.notEqual(reloadedPreset.memberBlueprints[0]?.title, 'Mutated title');
    });
});
