import DS from 'ember-data';
// @ts-ignore
import { singularize } from 'ember-inflector';
// TODO aside from .data(), key vs. id, metadata, and subcollection this is basicly realtime-database, should refactor to reuse
export default class FirestoreSerializer extends DS.JSONSerializer {
    normalizeSingleResponse(store, primaryModelClass, payload, _id, _requestType) {
        if (!payload.exists) {
            throw new DS.NotFoundError();
        }
        const meta = extractMeta(payload);
        let normalized = normalize(store, primaryModelClass, payload);
        this.applyTransforms(primaryModelClass, normalized.data.attributes);
        return Object.assign(Object.assign({}, normalized), { meta });
    }
    normalizeArrayResponse(store, primaryModelClass, payload, _id, _requestType) {
        const normalizedPayload = payload.docs.map(snapshot => {
            let normalized = normalize(store, primaryModelClass, snapshot);
            this.applyTransforms(primaryModelClass, normalized.data.attributes);
            return normalized;
        });
        const included = new Array().concat(...normalizedPayload.map(({ included }) => included));
        const meta = extractMeta(payload);
        const data = normalizedPayload.map(({ data }) => data);
        return { data, included, meta };
    }
    normalizeCreateRecordResponse(_store, _primaryModelClass, payload, id, _requestType) {
        return { data: { id: id || payload.doc.id, attributes: payload.data } };
    }
}
function isQuerySnapshot(arg) {
    return arg.query !== undefined;
}
const extractMeta = (snapshot) => {
    if (isQuerySnapshot(snapshot)) {
        const query = snapshot.query;
        return Object.assign(Object.assign({}, snapshot.metadata), { query });
    }
    else {
        return snapshot.metadata;
    }
};
const normalizeRelationships = (store, modelClass, attributes) => {
    const relationships = {};
    const included = [];
    modelClass.eachRelationship((key, relationship) => {
        const attribute = attributes.data()[key];
        const payload = attributes._document && attributes._document._included && attributes._document._included[key];
        if (payload) {
            const modelName = singularize(relationship.key);
            const modelClass = store.modelFor(modelName);
            const serializer = store.serializerFor(modelName);
            const { data } = relationship.kind === 'belongsTo' ? serializer.normalizeSingleResponse(store, modelClass, payload) : serializer.normalizeArrayResponse(store, modelClass, payload);
            if (Array.isArray(data)) {
                data.forEach((r) => {
                    return included.splice(-1, 0, Object.assign({ links: { self: 'emberfire' } }, r));
                });
            }
            else {
                included.splice(-1, 0, Object.assign({ links: { self: 'emberfire' } }, data));
            }
        }
        relationships[key] = normalizeRealtionship(relationship)(store, attribute, relationship, included);
    }, null);
    return { relationships, included };
};
const normalizeRealtionship = (relationship) => {
    if (relationship.kind == 'belongsTo') {
        return normalizeBelongsTo;
    }
    else if (relationship.options.subcollection) {
        return normalizeHasMany; // this is handled in the adapter
    }
    else if (relationship.options.embedded) {
        return normalizeEmbedded;
    }
    else {
        return normalizeHasMany;
    }
};
const normalizeBelongsTo = (_store, id, relationship, _included) => {
    if (id) {
        return { data: { id, type: relationship.type } };
    }
    else {
        return {};
    }
};
const normalizeEmbedded = (store, attribute, relationship, included) => {
    if (attribute) {
        Object.keys(attribute).forEach(id => {
            const val = attribute[id];
            const snapshot = { id, data: () => val };
            const model = store.modelFor(relationship.type);
            const { data, included: includes } = normalize(store, model, snapshot);
            included.push(data);
            includes.forEach((record) => included.push(record));
        });
        const data = included
            .filter(record => record.type == relationship.type)
            .map(record => ({ id: record.id, type: record.type }));
        if (data.length > 0) {
            return { links: { related: 'emberfire' }, data };
        }
        else {
            return { links: { related: 'emberfire' } };
        }
    }
    else {
        return {};
    }
};
const normalizeHasMany = (_store, _payload, relationship, included) => {
    const relevantIncluded = included.filter(i => i.type == singularize(relationship.key));
    const data = relevantIncluded.map((r) => ({ type: r.type, id: r.id }));
    if (data.length > 0) {
        return { links: { related: 'emberfire' }, data };
    }
    else {
        return { links: { related: 'emberfire' } };
    }
};
export const normalize = (store, modelClass, snapshot) => {
    const id = snapshot.id;
    const type = modelClass.modelName;
    const _ref = snapshot.ref;
    const attributes = Object.assign(Object.assign({}, snapshot.data()), { _ref });
    const { relationships, included } = normalizeRelationships(store, modelClass, snapshot);
    const data = { id, type, attributes, relationships };
    return { data, included };
};
