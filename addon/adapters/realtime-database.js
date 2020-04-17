import { pluralize } from 'ember-inflector';
import { camelize } from '@ember/string';
import DS from 'ember-data';
import { inject as service } from '@ember/service';
import { get, set } from '@ember/object';
/**
 * Persist your Ember Data models in the Firebase Realtime Database
 *
 * ```js
 * // app/adapters/application.js
 * import RealtimeDatabaseAdapter from 'emberfire/adapters/realtime-database';
 *
 * export default RealtimeDatabaseAdapter.extend({
 *   // configuration goes here
 * });
 * ```
 *
 */
export default class RealtimeDatabaseAdapter extends DS.Adapter.extend({
    namespace: undefined,
    firebaseApp: service('firebase-app'),
    databaseURL: undefined,
    database: undefined,
    defaultSerializer: '-realtime-database'
}) {
    findRecord(_store, type, id) {
        return docReference(this, type, id).then(doc => doc.once('value'));
    }
    findAll(store, type) {
        return this.query(store, type);
    }
    findHasMany(store, snapshot, url, relationship) {
        const adapter = store.adapterFor(relationship.type); // TODO kill the any
        if (adapter !== this) {
            return adapter.findHasMany(store, snapshot, url, relationship);
        }
        else if (relationship.options.subcollection) {
            throw `subcollections (${relationship.parentModelName}.${relationship.key}) are not supported by the Realtime Database, consider using embedded relationships or check out Firestore`;
        }
        else {
            return rootCollection(this, relationship.type).then(ref => queryDocs(ref.orderByChild(relationship.parentModelName).equalTo(snapshot.id), relationship.options.query));
        }
    }
    findBelongsTo(store, snapshot, url, relationship) {
        const adapter = store.adapterFor(relationship.type); // TODO kill the any
        if (adapter !== this) {
            return adapter.findBelongsTo(store, snapshot, url, relationship);
        }
        else {
            return docReference(this, relationship.type, snapshot.id).then(ref => ref.once('value'));
        }
    }
    query(_store, type, options) {
        return rootCollection(this, type).then(ref => queryDocs(ref, queryOptionsToQueryFn(options)));
    }
    queryRecord(_store, type, options) {
        const query = rootCollection(this, type).then(ref => queryDocs(ref.limitToFirst(1), queryOptionsToQueryFn(options)));
        return query.then(results => {
            let snapshot = undefined;
            results.forEach(doc => !!(snapshot = doc));
            if (snapshot) {
                return snapshot;
            }
            else {
                throw new DS.NotFoundError();
            }
        });
    }
    shouldBackgroundReloadRecord() {
        return false; // TODO can we make this dependent on a listener attached
    }
    updateRecord(_, type, snapshot) {
        const id = snapshot.id;
        const data = this.serialize(snapshot, { includeId: false });
        // TODO is this correct? e.g, clear dirty state and trigger didChange; what about failure?
        return docReference(this, type, id).then(ref => ref.set(data));
    }
    createRecord(_store, type, snapshot) {
        const id = snapshot.id;
        const data = this.serialize(snapshot, { includeId: false });
        if (id) {
            return docReference(this, type, id).then(ref => ref.set(data).then(() => ({ ref, data })));
        }
        else {
            return rootCollection(this, type).then(ref => ref.push()).then(ref => {
                snapshot._internalModel.setId(ref.key);
                return ref.set(data).then(() => ({ ref, data }));
            });
        }
    }
    deleteRecord(_, type, snapshot) {
        return docReference(this, type, snapshot.id).then(ref => ref.remove());
    }
}
// Keeping this for compatability with version 2
export var OrderBy;
(function (OrderBy) {
    OrderBy["Key"] = "_key";
    OrderBy["Value"] = "_value";
    OrderBy["Priority"] = "_priority";
})(OrderBy || (OrderBy = {}));
const isQueryOnly = (arg) => arg.query !== undefined;
// query: ref => ref.orderByChild('asdf')
// filter: { published: true }
// orderBy: OrderBy.Key, equalTo: 'asdf'
// orderBy: 'publishedAt'
const queryOptionsToQueryFn = (options) => (collectionRef) => {
    let ref = collectionRef;
    if (options) {
        if (isQueryOnly(options)) {
            return options.query(collectionRef);
        }
        if (options.filter) {
            Object.keys(options.filter).forEach(field => {
                ref = ref.orderByChild(field).equalTo(options.filter[field]);
            });
        }
        if (options.orderBy) {
            switch (options.orderBy) {
                case OrderBy.Key:
                    ref = ref.orderByKey();
                    break;
                case OrderBy.Priority:
                    ref = ref.orderByPriority();
                    break;
                case OrderBy.Value:
                    ref = ref.orderByValue();
                    break;
                default:
                    ref = ref.orderByChild(options.orderBy);
            }
        }
        if (options.equalTo !== undefined) {
            ref = options.equalTo && typeof options.equalTo === "object" ? ref.equalTo(options.equalTo[0], options.equalTo[1]) : ref.equalTo(options.equalTo);
        }
        if (options.startAt !== undefined) {
            ref = options.startAt && typeof options.startAt === "object" ? ref.startAt(options.startAt[0], options.startAt[1]) : ref.startAt(options.startAt);
        }
        if (options.endAt !== undefined) {
            ref = options.endAt && typeof options.endAt === "object" ? ref.endAt(options.endAt[0], options.endAt[1]) : ref.endAt(options.endAt);
        }
        if (options.limitToFirst) {
            ref = ref.limitToFirst(options.limitToFirst);
        }
        if (options.limitToLast) {
            ref = ref.limitToLast(options.limitToLast);
        }
    }
    return ref;
};
const noop = (ref) => ref;
const queryDocs = (referenceOrQuery, query) => getDocs((query || noop)(referenceOrQuery));
// TODO allow override
const collectionNameForType = (type) => pluralize(camelize(typeof (type) === 'string' ? type : type.modelName));
export const rootCollection = (adapter, type) => databaseInstance(adapter).then(database => database.ref([get(adapter, 'namespace'), collectionNameForType(type)].join('/')));
const getDocs = (query) => query.once('value').then(value => (value.query = query) && value);
const docReference = (adapter, type, id) => rootCollection(adapter, type).then(ref => ref.child(id));
const databaseInstance = (adapter) => {
    let database = get(adapter, 'database');
    if (!database) {
        const app = get(adapter, 'firebaseApp');
        const databaseURL = get(adapter, 'databaseURL');
        database = app.database(databaseURL);
        set(adapter, 'database', database);
    }
    return database;
};
