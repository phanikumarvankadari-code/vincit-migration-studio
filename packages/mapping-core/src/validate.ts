import type { Diagnostic } from './diagnostics.js';
import type { LookupDefinition, RoutineDefinition } from './library.js';
import type { MappingDefinition, ValueOperand, ConditionExpr } from './mapping.js';
import type { MappingSnapshot } from './snapshot.js';
import type { Project } from './project.js';
import type { SourceDefinition } from './source.js';
import type { TargetDefinition } from './target.js';

/** The parts of a project or snapshot that must be referentially consistent. */
export interface ModelParts {
  sourceDefinitions: readonly SourceDefinition[];
  targetDefinition?: TargetDefinition | undefined;
  mappingDefinition: MappingDefinition;
  routines: readonly RoutineDefinition[];
  lookups: readonly LookupDefinition[];
}

export const ModelIssueCode = {
  DuplicateId: 'MODEL_DUPLICATE_ID',
  ParentMismatch: 'MODEL_PARENT_MISMATCH',
  UnknownDataset: 'MODEL_UNKNOWN_DATASET',
  UnknownSourceField: 'MODEL_UNKNOWN_SOURCE_FIELD',
  UnknownTargetStructure: 'MODEL_UNKNOWN_TARGET_STRUCTURE',
  UnknownTargetField: 'MODEL_UNKNOWN_TARGET_FIELD',
  UnknownRelationship: 'MODEL_UNKNOWN_RELATIONSHIP',
  UnknownRoutine: 'MODEL_UNKNOWN_ROUTINE',
  UnknownLookup: 'MODEL_UNKNOWN_LOOKUP',
  UndeclaredRoutine: 'MODEL_UNDECLARED_ROUTINE',
  UndeclaredLookup: 'MODEL_UNDECLARED_LOOKUP',
  DuplicateMapping: 'MODEL_DUPLICATE_MAPPING',
  BadSourceArity: 'MODEL_BAD_SOURCE_ARITY',
  EmptyChain: 'MODEL_EMPTY_CHAIN',
  DuplicateOrder: 'MODEL_DUPLICATE_ORDER',
  InvalidParentLink: 'MODEL_INVALID_PARENT_LINK',
} as const;

export function validateModel(parts: ModelParts): Diagnostic[] {
  const issues: Diagnostic[] = [];
  const add = (
    code: string,
    message: string,
    path: string,
    extra: Partial<Diagnostic> = {},
  ): void => {
    issues.push({ severity: 'error', code, message, path, ...extra });
  };

  // Indexes
  const datasets = new Map<string, Set<string>>(); // datasetId -> fieldIds
  const targetStructures = new Map<string, Set<string>>(); // structureId -> fieldIds
  const routineIds = new Set(parts.routines.map((r) => r.id as string));
  const lookupIds = new Set(parts.lookups.map((l) => l.id as string));
  const relationshipIds = new Set(parts.mappingDefinition.relationships.map((r) => r.id as string));
  const declaredRoutines = new Set(
    parts.mappingDefinition.routineReferences.map((r) => r.routineId as string),
  );
  const declaredLookups = new Set(
    parts.mappingDefinition.lookupReferences.map((l) => l.lookupId as string),
  );

  const seen = new Map<string, Set<string>>();
  const unique = (kind: string, id: string, path: string): void => {
    const set = seen.get(kind) ?? new Set<string>();
    seen.set(kind, set);
    if (set.has(id)) add(ModelIssueCode.DuplicateId, `Duplicate ${kind} id "${id}".`, path);
    set.add(id);
  };

  parts.sourceDefinitions.forEach((def, i) => {
    unique('source definition', def.id, `sourceDefinitions[${i}].id`);
    def.datasets.forEach((ds, j) => {
      const dsPath = `sourceDefinitions[${i}].datasets[${j}]`;
      unique('source dataset', ds.id, `${dsPath}.id`);
      if (ds.sourceId !== def.id) {
        add(
          ModelIssueCode.ParentMismatch,
          `Dataset "${ds.id}" says source "${ds.sourceId}" but sits in "${def.id}".`,
          `${dsPath}.sourceId`,
        );
      }
      const fields = new Set<string>();
      ds.fields.forEach((f, k) => {
        unique('source field', f.id, `${dsPath}.fields[${k}].id`);
        if (f.datasetId !== ds.id) {
          add(
            ModelIssueCode.ParentMismatch,
            `Field "${f.id}" says dataset "${f.datasetId}" but sits in "${ds.id}".`,
            `${dsPath}.fields[${k}].datasetId`,
          );
        }
        fields.add(f.id);
      });
      datasets.set(ds.id, fields);
    });
  });

  const td = parts.targetDefinition;
  td?.structures.forEach((s, i) => {
    const sPath = `targetDefinition.structures[${i}]`;
    unique('target structure', s.id, `${sPath}.id`);
    if (s.targetDefinitionId !== td.id) {
      add(
        ModelIssueCode.ParentMismatch,
        `Structure "${s.id}" says target "${s.targetDefinitionId}" but sits in "${td.id}".`,
        `${sPath}.targetDefinitionId`,
      );
    }
    const fields = new Set<string>();
    s.fields.forEach((f, k) => {
      unique('target field', f.id, `${sPath}.fields[${k}].id`);
      if (f.targetStructureId !== s.id) {
        add(
          ModelIssueCode.ParentMismatch,
          `Field "${f.id}" says structure "${f.targetStructureId}" but sits in "${s.id}".`,
          `${sPath}.fields[${k}].targetStructureId`,
        );
      }
      fields.add(f.id);
    });
    targetStructures.set(s.id, fields);
  });

  parts.routines.forEach((r, i) => unique('routine', r.id, `routines[${i}].id`));
  parts.lookups.forEach((l, i) => unique('lookup', l.id, `lookups[${i}].id`));
  parts.mappingDefinition.relationships.forEach((r, i) =>
    unique('relationship', r.id, `mappingDefinition.relationships[${i}].id`),
  );
  parts.mappingDefinition.mappings.forEach((m, i) =>
    unique('field mapping', m.id, `mappingDefinition.mappings[${i}].id`),
  );
  parts.mappingDefinition.validationRules.forEach((r, i) =>
    unique('validation rule', r.id, `mappingDefinition.validationRules[${i}].id`),
  );

  const checkDatasetField = (
    datasetId: string,
    fieldId: string | undefined,
    path: string,
    extra: Partial<Diagnostic> = {},
  ): void => {
    const fields = datasets.get(datasetId);
    if (!fields) {
      add(ModelIssueCode.UnknownDataset, `Dataset "${datasetId}" does not exist.`, path, extra);
    } else if (fieldId !== undefined && !fields.has(fieldId)) {
      add(
        ModelIssueCode.UnknownSourceField,
        `Field "${fieldId}" does not exist in dataset "${datasetId}".`,
        path,
        extra,
      );
    }
  };

  // Relationships
  parts.mappingDefinition.relationships.forEach((r, i) => {
    const p = `mappingDefinition.relationships[${i}]`;
    checkDatasetField(r.leftDatasetId, undefined, `${p}.leftDatasetId`);
    checkDatasetField(r.rightDatasetId, undefined, `${p}.rightDatasetId`);
    r.keys.forEach((k, j) => {
      checkDatasetField(r.leftDatasetId, k.leftFieldId, `${p}.keys[${j}].leftFieldId`);
      checkDatasetField(r.rightDatasetId, k.rightFieldId, `${p}.keys[${j}].rightFieldId`);
    });
  });

  // Target structure links
  td?.structures.forEach((s, i) => {
    const p = `targetDefinition.structures[${i}]`;
    if (s.generation) {
      checkDatasetField(s.generation.driverDatasetId, undefined, `${p}.generation.driverDatasetId`);
      s.generation.viaRelationshipIds?.forEach((rid, j) => {
        if (!relationshipIds.has(rid)) {
          add(
            ModelIssueCode.UnknownRelationship,
            `Relationship "${rid}" does not exist.`,
            `${p}.generation.viaRelationshipIds[${j}]`,
          );
        }
      });
    }
    if (s.parent) {
      const parentFields = targetStructures.get(s.parent.parentStructureId);
      if (!parentFields) {
        add(
          ModelIssueCode.InvalidParentLink,
          `Parent structure "${s.parent.parentStructureId}" does not exist.`,
          `${p}.parent.parentStructureId`,
        );
      } else {
        const childFields = targetStructures.get(s.id) ?? new Set<string>();
        s.parent.keys.forEach((k, j) => {
          if (!childFields.has(k.childFieldId) || !parentFields.has(k.parentFieldId)) {
            add(
              ModelIssueCode.InvalidParentLink,
              `Parent key pair ${j} must reference a field of this structure and a field of the parent.`,
              `${p}.parent.keys[${j}]`,
            );
          }
        });
      }
    }
  });

  // Manifests
  parts.mappingDefinition.routineReferences.forEach((r, i) => {
    const def = parts.routines.find((x) => x.id === r.routineId);
    if (!def || def.version !== r.version) {
      add(
        ModelIssueCode.UnknownRoutine,
        `Routine "${r.routineId}" version "${r.version}" is not defined.`,
        `mappingDefinition.routineReferences[${i}]`,
      );
    }
  });
  parts.mappingDefinition.lookupReferences.forEach((l, i) => {
    if (!lookupIds.has(l.lookupId)) {
      add(
        ModelIssueCode.UnknownLookup,
        `Lookup "${l.lookupId}" is not defined.`,
        `mappingDefinition.lookupReferences[${i}]`,
      );
    }
  });

  const useLookup = (id: string, path: string): void => {
    if (!lookupIds.has(id))
      add(ModelIssueCode.UnknownLookup, `Lookup "${id}" is not defined.`, path);
    else if (!declaredLookups.has(id))
      add(
        ModelIssueCode.UndeclaredLookup,
        `Lookup "${id}" is used but not declared in lookupReferences.`,
        path,
      );
  };
  const checkOperand = (o: ValueOperand, path: string): void => {
    if (o.kind === 'field') checkDatasetField(o.datasetId, o.fieldId, path);
  };
  const checkCondition = (c: ConditionExpr, path: string): void => {
    switch (c.op) {
      case 'compare':
        checkOperand(c.left, `${path}.left`);
        checkOperand(c.right, `${path}.right`);
        break;
      case 'in':
      case 'isEmpty':
        checkOperand(c.operand, `${path}.operand`);
        break;
      case 'and':
      case 'or':
        c.conditions.forEach((x, i) => checkCondition(x, `${path}.conditions[${i}]`));
        break;
      case 'not':
        checkCondition(c.condition, `${path}.condition`);
        break;
    }
  };

  // Mappings
  const mappedTargets = new Set<string>();
  parts.mappingDefinition.mappings.forEach((m, i) => {
    const p = `mappingDefinition.mappings[${i}]`;
    const ctx = {
      fieldMappingId: m.id,
      targetStructureId: m.targetStructureId,
      targetFieldId: m.targetFieldId,
    };

    const fields = targetStructures.get(m.targetStructureId);
    if (!fields) {
      add(
        ModelIssueCode.UnknownTargetStructure,
        `Target structure "${m.targetStructureId}" does not exist.`,
        `${p}.targetStructureId`,
        ctx,
      );
    } else if (!fields.has(m.targetFieldId)) {
      add(
        ModelIssueCode.UnknownTargetField,
        `Target field "${m.targetFieldId}" does not exist in structure "${m.targetStructureId}".`,
        `${p}.targetFieldId`,
        ctx,
      );
    }
    const key = `${m.targetStructureId}/${m.targetFieldId}`;
    if (mappedTargets.has(key)) {
      add(
        ModelIssueCode.DuplicateMapping,
        `Target field "${m.targetFieldId}" has more than one mapping.`,
        p,
        ctx,
      );
    }
    mappedTargets.add(key);

    m.sourceReferences.forEach((s, j) =>
      checkDatasetField(s.datasetId, s.fieldId, `${p}.sourceReferences[${j}]`, ctx),
    );

    if (m.mappingType === 'direct' && m.sourceReferences.length !== 1) {
      add(
        ModelIssueCode.BadSourceArity,
        'A direct mapping needs exactly one source reference.',
        `${p}.sourceReferences`,
        ctx,
      );
    }
    if (m.mappingType === 'constant' && m.sourceReferences.length !== 0) {
      add(
        ModelIssueCode.BadSourceArity,
        'A constant mapping takes no source references.',
        `${p}.sourceReferences`,
        ctx,
      );
    }
    if (m.mappingType === 'routine' && m.transformations.length === 0) {
      add(
        ModelIssueCode.EmptyChain,
        'A routine mapping needs at least one transformation step.',
        `${p}.transformations`,
        ctx,
      );
    }
    if (m.mappingType === 'lookup') useLookup(m.lookup.lookupId, `${p}.lookup.lookupId`);
    if (m.mappingType === 'javascript') {
      m.javascript.declaredLookupIds.forEach((id, j) =>
        useLookup(id, `${p}.javascript.declaredLookupIds[${j}]`),
      );
    }
    if (m.mappingType === 'conditional') {
      m.conditional.rules.forEach((r, j) => {
        checkCondition(r.when, `${p}.conditional.rules[${j}].when`);
        checkOperand(r.then, `${p}.conditional.rules[${j}].then`);
      });
      if (m.conditional.otherwise)
        checkOperand(m.conditional.otherwise, `${p}.conditional.otherwise`);
    }

    const orders = new Set<number>();
    m.transformations.forEach((t, j) => {
      const tp = `${p}.transformations[${j}]`;
      if (orders.has(t.order))
        add(
          ModelIssueCode.DuplicateOrder,
          `Transformation order ${t.order} is used more than once.`,
          `${tp}.order`,
          ctx,
        );
      orders.add(t.order);
      if (t.kind === 'routine') {
        if (!routineIds.has(t.routineId)) {
          add(
            ModelIssueCode.UnknownRoutine,
            `Routine "${t.routineId}" is not defined.`,
            `${tp}.routineId`,
            { ...ctx, routineId: t.routineId },
          );
        } else if (!declaredRoutines.has(t.routineId)) {
          add(
            ModelIssueCode.UndeclaredRoutine,
            `Routine "${t.routineId}" is used but not declared in routineReferences.`,
            `${tp}.routineId`,
            { ...ctx, routineId: t.routineId },
          );
        }
      } else {
        useLookup(t.lookupId, `${tp}.lookupId`);
      }
    });
  });

  // Validation rules
  parts.mappingDefinition.validationRules.forEach((r, i) => {
    const p = `mappingDefinition.validationRules[${i}].scope`;
    if (r.scope.kind === 'targetStructure') {
      if (!targetStructures.has(r.scope.targetStructureId)) {
        add(
          ModelIssueCode.UnknownTargetStructure,
          `Target structure "${r.scope.targetStructureId}" does not exist.`,
          p,
        );
      }
    } else {
      const id = r.scope.targetFieldId as string;
      if (![...targetStructures.values()].some((f) => f.has(id))) {
        add(ModelIssueCode.UnknownTargetField, `Target field "${id}" does not exist.`, p);
      }
    }
  });

  return issues;
}

export function validateProject(project: Project): Diagnostic[] {
  return validateModel(project);
}

export function validateSnapshot(snapshot: MappingSnapshot): Diagnostic[] {
  return validateModel({
    sourceDefinitions: snapshot.sourceSchemas,
    targetDefinition: snapshot.targetDefinition,
    mappingDefinition: snapshot.mappingDefinition,
    routines: snapshot.routines,
    lookups: snapshot.lookups,
  });
}
