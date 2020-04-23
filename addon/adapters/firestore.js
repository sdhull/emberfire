import DS from 'ember-data';
import { getOwner } from '@ember/application';
import { pluralize } from 'ember-inflector';
import { get, set } from '@ember/object';
import { inject as service } from '@ember/service';
import { camelize } from '@ember/string';
import { resolve } from 'rsvp';
/**
 * Persist your Ember Data models in Cloud Firestore
 *
 * ```js
 * // app/adapters/application.js
 * import FirestoreAdapter from 'emberfire/adapters/firestore';
 *
 * export default FirestoreAdapter.extend({
 *   // configuration goes here
 * });
 * ```
 *
 */
export default class FirestoreAdapter extends DS.Adapter.extend({
    namespace: undefined,
    firebaseApp: service('firebase-app'),
    settings: {},
    enablePersistence: false,
    persistenceSettings: {},
    firestore: undefined,
    defaultSerializer: '-firestore'
}) {
    findRecord(store, type, id, snapshot) {
        return rootCollection(this, type).then(ref => includeRelationships(ref.doc(id).get(), store, this, snapshot, type));
    }
    findAll(store, type) {
        return this.query(store, type);
    }
    findHasMany(store, snapshot, url, relationship) {
        const adapter = store.adapterFor(relationship.type); // TODO fix types
        if (adapter !== this) {
            return adapter.findHasMany(store, snapshot, url, relationship);
        }
        else if (relationship.options.subcollection) {
            return docReference(this, relationship.parentModelName, snapshot.id).then(doc => queryDocs(doc.collection(collectionNameForType(relationship.type)), relationship.options.query));
        }
        else {
            return rootCollection(this, relationship.type).then(collection => queryDocs(collection.where(relationship.parentModelName, '==', snapshot.id), relationship.options.query));
        }
    }
    findBelongsTo(store, snapshot, url, relationship) {
        const adapter = store.adapterFor(relationship.type); // TODO fix types
        if (adapter !== this) {
            return adapter.findBelongsTo(store, snapshot, url, relationship);
        }
        else {
            return getDoc(this, relationship.type, snapshot.id);
        }
    }
    query(store, type, options, _recordArray) {
        return rootCollection(this, type).then(collection => queryDocs(collection, queryOptionsToQueryFn(options))).then(q => includeCollectionRelationships(q, store, this, options, type));
    }
    queryRecord(store, type, options) {
        return rootCollection(this, type).then((ref) => {
            const queryOrRef = queryRecordOptionsToQueryFn(options)(ref);
            if (isQuery(queryOrRef)) {
                return queryOrRef.limit(1).get();
            }
            else {
                options.id = queryOrRef.id;
                return includeRelationships(queryOrRef.get(), store, this, options, type); // TODO fix the types here, they're a little broken
            }
        }).then((snapshot) => {
            if (isQuerySnapshot(snapshot)) {
                return includeRelationships(resolve(snapshot.docs[0]), store, this, options, type);
            }
            else {
                return snapshot;
            }
        });
    }
    shouldBackgroundReloadRecord() {
        return false; // TODO can we make this dependent on a listener attached
    }
    updateRecord(_store, type, snapshot) {
        const id = snapshot.id;
        const data = this.serialize(snapshot, { includeId: false });
        // TODO is this correct? e.g, clear dirty state and trigger didChange; what about failure?
        return docReference(this, type, id).then(doc => doc.update(data));
    }
    createRecord(_store, type, snapshot) {
        const id = snapshot.id;
        const data = this.serialize(snapshot, { includeId: false });
        if (id) {
            return docReference(this, type, id).then(doc => doc.set(data).then(() => ({ doc, data })));
        }
        else {
            return rootCollection(this, type).then(collection => {
                const doc = collection.doc();
                snapshot._internalModel.setId(doc.id);
                return doc.set(data).then(() => ({ doc, data }));
            });
        }
    }
    deleteRecord(_store, type, snapshot) {
        return docReference(this, type, snapshot.id).then(doc => doc.delete());
    }
}
// Type guards
const isDocOnly = (arg) => arg.doc !== undefined;
const isQueryOnly = (arg) => arg.query !== undefined;
const isQuery = (arg) => arg.limit !== undefined;
const isWhereOp = (arg) => typeof arg[0] === "string" || arg[0].length === undefined;
const isQuerySnapshot = (arg) => arg.docs !== undefined;
// Helpers
const noop = (ref) => ref;
const getDoc = (adapter, type, id) => docReference(adapter, type, id).then(doc => doc.get());
// TODO allow override
const collectionNameForType = (type) => pluralize(camelize(typeof (type) === 'string' ? type : type.modelName));
const docReference = (adapter, type, id) => rootCollection(adapter, type).then(collection => collection.doc(id));
const getDocs = (query) => query.get();
export const rootCollection = (adapter, type) => getFirestore(adapter).then(firestore => {
    const namespace = get(adapter, 'namespace');
    const root = namespace ? firestore.doc(namespace) : firestore;
    return root.collection(collectionNameForType(type));
});
const queryDocs = (referenceOrQuery, query) => getDocs((query || noop)(referenceOrQuery));
const queryRecordOptionsToQueryFn = (options) => (ref) => isDocOnly(options) ? options.doc(ref) : queryOptionsToQueryFn(options)(ref);
// query: ref => ref.where(...)
// filter: { published: true }
// where: ['something', '<', 11]
// where: [['something', '<', 11], ['else', '==', true]]
// orderBy: 'publishedAt'
// orderBy: { publishedAt: 'desc' }
const queryOptionsToQueryFn = (options) => (collectionRef) => {
    let ref = collectionRef;
    if (options) {
        if (isQueryOnly(options)) {
            return options.query(collectionRef);
        }
        if (options.filter) {
            Object.keys(options.filter).forEach(field => {
                ref = ref.where(field, '==', options.filter[field]);
            });
        }
        if (options.where) {
            const runWhereOp = ([field, op, value]) => ref = ref.where(field, op, value);
            if (isWhereOp(options.where)) {
                runWhereOp(options.where);
            }
            else {
                options.where.forEach(runWhereOp);
            }
        }
        if (options.endAt) {
            ref = ref.endAt(options.endAt);
        }
        if (options.endBefore) {
            ref = ref.endBefore(options.endBefore);
        }
        if (options.startAt) {
            ref = ref.startAt(options.startAt);
        }
        if (options.startAfter) {
            ref = ref.startAt(options.startAfter);
        }
        if (options.orderBy) {
            if (typeof options.orderBy === "string") {
                ref = ref.orderBy(options.orderBy);
            }
            else {
                Object.keys(options.orderBy).forEach(field => {
                    ref = ref.orderBy(field, options.orderBy[field]); // TODO fix type
                });
            }
        }
        if (options.limit) {
            ref = ref.limit(options.limit);
        }
    }
    return ref;
};
const getFirestore = (adapter) => {
    let cachedFirestoreInstance = get(adapter, 'firestore');
    if (!cachedFirestoreInstance) {
        const app = get(adapter, 'firebaseApp');
        cachedFirestoreInstance = app.firestore().then(firestore => {
            const settings = get(adapter, 'settings');
            firestore.settings(settings);
            const enablePersistence = get(adapter, 'enablePersistence');
            const fastboot = getOwner(adapter).lookup('service:fastboot');
            if (enablePersistence && (fastboot == null || !fastboot.isFastBoot)) {
                const persistenceSettings = get(adapter, 'persistenceSettings');
                firestore.enablePersistence(persistenceSettings).catch(console.warn);
            }
            return firestore;
        });
        set(adapter, 'firestore', cachedFirestoreInstance);
    }
    return cachedFirestoreInstance;
};
const includeCollectionRelationships = (collection, store, adapter, snapshot, type) => {
    if (snapshot && snapshot.include) {
        const includes = snapshot.include.split(',');
        const relationshipsToInclude = includes.map(e => type.relationshipsByName.get(e)).filter(r => !!r && !r.options.embedded);
        return Promise.all(relationshipsToInclude.map(r => {
            if (r.meta.kind == 'hasMany') {
                return Promise.all(collection.docs.map(d => adapter.findHasMany(store, { id: d.id }, '', r)));
            }
            else {
                const belongsToIds = [...new Set(collection.docs.map(d => d.data()[r.meta.key]).filter(id => !!id))];
                return Promise.all(belongsToIds.map(id => adapter.findBelongsTo(store, { id }, '', r)));
            }
        })).then(allIncludes => {
            relationshipsToInclude.forEach((r, i) => {
                const relationship = r.meta;
                const pluralKey = pluralize(relationship.key);
                const key = relationship.kind == 'belongsTo' ? relationship.key : pluralKey;
                const includes = allIncludes[i];
                collection.docs.forEach(doc => {
                    if (relationship.kind == 'belongsTo') {
                        const result = includes.find((r) => r.id == doc.data()[key]);
                        if (result) {
                            if (!doc._document._included) {
                                doc._document._included = {};
                            }
                            doc._document._included[key] = result;
                        }
                    }
                    else {
                        if (!doc._document._included) {
                            doc._document._included = {};
                        }
                        doc._document._included[pluralKey] = includes;
                    }
                });
            });
            return collection;
        });
    }
    else {
        return resolve(collection);
    }
};
const includeRelationships = (promise, store, adapter, snapshot, type) => {
    if (snapshot && snapshot.include) {
        const includes = snapshot.include.split(',');
        const relationshipsToInclude = includes.map(e => type.relationshipsByName.get(e)).filter(r => !!r && !r.options.embedded);
        const hasManyRelationships = relationshipsToInclude.filter(r => r.meta.kind == 'hasMany');
        const belongsToRelationships = relationshipsToInclude.filter(r => r.meta.kind == 'belongsTo');
        return Promise.all([
            promise,
            ...hasManyRelationships.map(r => adapter.findHasMany(store, snapshot, '', r))
        ]).then(([doc, ...includes]) => {
            doc._document._included = hasManyRelationships.reduce((c, e, i) => {
                c[pluralize(e.key)] = includes[i];
                return c;
            }, {});
            return Promise.all([
                resolve(doc),
                ...belongsToRelationships.filter(r => !!doc.data()[r.meta.key]).map(r => {
                    return adapter.findBelongsTo(store, { id: doc.data()[r.meta.key] }, '', r);
                })
            ]);
        }).then(([doc, ...includes]) => {
            doc._document._included = Object.assign(Object.assign({}, doc._document._included), belongsToRelationships.reduce((c, e, i) => {
                c[e.key] = includes[i];
                return c;
            }, {}));
            return doc;
        });
    }
    else {
        return promise;
    }
};
