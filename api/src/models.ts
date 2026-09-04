import mongoose, { Schema } from 'mongoose';
import { ALL_UNITS, COUNT_UNITS, FORMS } from '@home-kitchen/shared';

const json = {
  versionKey: false,
  transform: (_doc: unknown, ret: Record<string, unknown>) => { ret.id = String(ret._id); delete ret._id; return ret; },
};
const opts = { timestamps: true, toJSON: json, toObject: json };

const StoreSchema = new Schema({
  name: { type: String, required: true, trim: true, unique: true },
  sortOrder: { type: Number, required: true, default: 0 },
  color: { type: String, required: true, default: '#776d63' },
}, opts);

const SettingsSchema = new Schema({
  _id: { type: String, default: 'settings' },
  people: { type: Number, required: true, default: 2, min: 1 },
  weekStartsOn: { type: Number, required: true, default: 6, min: 0, max: 6 },
}, { ...opts, toJSON: { versionKey: false, transform: (_d: unknown, r: { _id?: unknown }) => { delete r._id; return r; } } });

const IngredientSchema = new Schema({
  name: { type: String, required: true, trim: true },
  nameKey: { type: String, required: true, unique: true },
  kind: { type: String, required: true, enum: ['fresh', 'weekly', 'pantry'] },
  storeId: { type: Schema.Types.ObjectId, ref: 'Store', required: true },
  form: { type: String, required: true, enum: FORMS },
  weeklyQty: { type: Number, min: 0 },
  isLow: { type: Boolean, default: false },
  buyUnit: { type: String, enum: ALL_UNITS },
  stockUnit: { type: String, enum: ALL_UNITS },
  countUnit: { type: String, enum: COUNT_UNITS },
  ozPerCup: { type: Number, min: 0 },
  ozPerCount: { type: Number, min: 0 },
  expiresOn: { type: String, match: /^\d{4}-\d{2}-\d{2}$/ },
}, opts);
IngredientSchema.pre('validate', function (next) {
  const self = this as unknown as { name?: string; nameKey?: string };
  self.nameKey = String(self.name ?? '').trim().toLowerCase();
  next();
});

const RecipeLineSchema = new Schema({
  ingredientId: { type: Schema.Types.ObjectId, ref: 'Ingredient', required: true },
  qty: { type: Number, min: 0 },
  unit: { type: String, enum: ALL_UNITS },
  note: { type: String, trim: true },
}, { _id: false });
const RecipeSchema = new Schema({
  title: { type: String, required: true, trim: true },
  ingredients: { type: [RecipeLineSchema], default: [] },
  steps: { type: [String], default: [] },
  tags: { type: [String], default: [] },
}, opts);

const PlannedDaySchema = new Schema({
  date: { type: String, required: true, unique: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  breakfast: { type: [{ type: Schema.Types.ObjectId, ref: 'Recipe' }], default: [] },
  dinner: { type: [{ type: Schema.Types.ObjectId, ref: 'Recipe' }], default: [] },
}, opts);

// A fast day is a bare mark on a date (§4); the dish itself lives in that day's PlannedDay.dinner.
const EkadashiDaySchema = new Schema({
  date: { type: String, required: true, unique: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  name: { type: String, trim: true },
}, opts);

const FreshStockSchema = new Schema({
  ingredientId: { type: Schema.Types.ObjectId, ref: 'Ingredient', required: true, unique: true },
  qty: { type: Number, required: true, min: 0 },
  unit: { type: String, required: true, enum: ALL_UNITS },
  enteredAt: { type: Date, default: Date.now },
}, opts);

const ShoppingItemSchema = new Schema({
  ingredientId: { type: String, required: true },
  name: { type: String, required: true },
  storeId: { type: String, required: true },
  group: { type: String, required: true },
  source: { type: String, required: true, enum: ['auto', 'weekly', 'low', 'manual'] },
  needQty: Number, needUnit: String, haveQty: Number, haveUnit: String,
  buyQty: Number, buyUnit: String, altQty: Number, altUnit: String,
  checked: { type: Boolean, default: false },
}, { _id: false });
const ShoppingListSchema = new Schema({
  startDate: { type: String, required: true, unique: true },
  endDate: { type: String, required: true },
  generatedAt: { type: Date, default: Date.now },
  status: { type: String, enum: ['active', 'archived'], default: 'active' },
  people: { type: Number, required: true },
  items: { type: [ShoppingItemSchema], default: [] },
  problems: { type: [{ ingredientId: String, name: String, reason: String, _id: false }], default: [] },
  pantryCheck: { type: [{ ingredientId: String, name: String, storeId: String, isLow: Boolean, _id: false }], default: [] },
}, opts);

export const StoreModel = mongoose.model('Store', StoreSchema);
export const SettingsModel = mongoose.model('Settings', SettingsSchema);
export const IngredientModel = mongoose.model('Ingredient', IngredientSchema);
export const RecipeModel = mongoose.model('Recipe', RecipeSchema);
export const PlannedDayModel = mongoose.model('PlannedDay', PlannedDaySchema);
export const EkadashiDayModel = mongoose.model('EkadashiDay', EkadashiDaySchema);
export const FreshStockModel = mongoose.model('FreshStock', FreshStockSchema);
export const ShoppingListModel = mongoose.model('ShoppingList', ShoppingListSchema);
