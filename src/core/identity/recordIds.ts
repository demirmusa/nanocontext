import * as crypto from 'crypto';
import { ClassInfo, HeaderJson, MethodInfo, ParsedClassInfo, ParsedMethodInfo } from '../interfaces/types';

function hashIdentity(parts: string[]): string {
  return crypto.createHash('sha1').update(parts.join('\u241f')).digest('hex').slice(0, 16);
}

export function buildMethodId(filePath: string, method: Pick<MethodInfo, 'name' | 'class' | 'sig'>): string {
  return `method:${hashIdentity([filePath, method.class ?? '', method.name, method.sig])}`;
}

export function buildClassId(filePath: string, cls: Pick<ClassInfo, 'name' | 'loc'>): string {
  return `class:${hashIdentity([filePath, cls.name, cls.loc])}`;
}

export function buildMethodLocationKey(filePath: string, method: Pick<MethodInfo, 'loc'>): string {
  return `${filePath}::${method.loc}`;
}

export function withMethodId(filePath: string, method: Omit<MethodInfo, 'id'> & Partial<Pick<MethodInfo, 'id'>>): MethodInfo {
  return {
    ...method,
    id: method.id || buildMethodId(filePath, method),
  };
}

export function withClassId(filePath: string, cls: Omit<ClassInfo, 'id'> & Partial<Pick<ClassInfo, 'id'>>): ClassInfo {
  return {
    ...cls,
    id: cls.id || buildClassId(filePath, cls),
  };
}

type HeaderIdentityInput = Omit<HeaderJson, 'classes' | 'methods'> & {
  classes: Array<ClassInfo | ParsedClassInfo>;
  methods: Array<MethodInfo | ParsedMethodInfo>;
};

export function applyHeaderIdentity(header: HeaderIdentityInput): HeaderJson {
  return {
    ...header,
    classes: header.classes.map(cls => withClassId(header.file, cls)),
    methods: header.methods.map(method => withMethodId(header.file, method)),
  };
}
