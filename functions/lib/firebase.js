"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.storage = exports.db = exports.firestore = exports.FIRESTORE_DATABASE_ID = void 0;
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
const storage_1 = require("firebase-admin/storage");
const adminModule = __importStar(require("firebase-admin"));
if ((0, app_1.getApps)().length === 0) {
    (0, app_1.initializeApp)();
}
exports.FIRESTORE_DATABASE_ID = "g-elite-g";
exports.firestore = (0, firestore_1.getFirestore)(exports.FIRESTORE_DATABASE_ID);
exports.db = exports.firestore;
exports.storage = (0, storage_1.getStorage)();
const legacyAdmin = {
    ...adminModule,
    get apps() {
        return (0, app_1.getApps)();
    },
    firestore: () => exports.firestore,
    storage: () => exports.storage,
    initializeApp: () => (0, app_1.getApps)()[0] || (0, app_1.initializeApp)(),
};
exports.default = legacyAdmin;
//# sourceMappingURL=firebase.js.map