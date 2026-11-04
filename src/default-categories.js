// Owner-editable default categories. Edit this list and push; no build step.
// Renames or type changes here never touch an existing user's category.
// Removing an entry here does nothing to existing categories.

/** @import {CategoryKind, BudgetType} from './types.js' */

/** @type {{id:string,name:string,kind:CategoryKind,budgetType?:BudgetType}[]} */
export default [
  { id: 'salary', name: 'Salary', kind: 'income', budgetType: 'fixed' },
  { id: 'other-income', name: 'Other income', kind: 'income', budgetType: 'variable' },
  { id: 'contributions', name: 'Contributions from others', kind: 'contribution', budgetType: 'fixed' },
  { id: 'housing', name: 'Housing (rent or mortgage)', kind: 'spend', budgetType: 'fixed' },
  { id: 'council-tax', name: 'Council tax', kind: 'spend', budgetType: 'fixed' },
  { id: 'utilities', name: 'Utilities', kind: 'spend', budgetType: 'fixed' },
  { id: 'insurance', name: 'Insurance', kind: 'spend', budgetType: 'annual' },
  { id: 'groceries', name: 'Groceries', kind: 'spend', budgetType: 'variable' },
  { id: 'eating-out', name: 'Eating out', kind: 'spend', budgetType: 'variable' },
  { id: 'takeaway', name: 'Takeaway', kind: 'spend', budgetType: 'variable' },
  { id: 'transport', name: 'Transport', kind: 'spend', budgetType: 'variable' },
  { id: 'car', name: 'Car', kind: 'spend', budgetType: 'fixed' },
  { id: 'subscriptions', name: 'Subscriptions', kind: 'spend', budgetType: 'fixed' },
  { id: 'health', name: 'Health', kind: 'spend', budgetType: 'variable' },
  { id: 'personal-care', name: 'Personal care', kind: 'spend', budgetType: 'variable' },
  { id: 'clothing', name: 'Clothing', kind: 'spend', budgetType: 'annual' },
  { id: 'entertainment', name: 'Entertainment', kind: 'spend', budgetType: 'variable' },
  { id: 'gifts', name: 'Gifts', kind: 'spend', budgetType: 'annual' },
  { id: 'holidays', name: 'Holidays', kind: 'spend', budgetType: 'annual' },
  { id: 'household-maintenance', name: 'Household maintenance', kind: 'spend', budgetType: 'annual' },
  { id: 'joint-household', name: 'Joint household', kind: 'spend', budgetType: 'fixed' },
  { id: 'big-one-offs', name: 'Big one-offs', kind: 'spend', budgetType: 'oneoff' },
  { id: 'between-accounts', name: 'Between my accounts', kind: 'transfer' },
  { id: 'card-repayments', name: 'Card repayments', kind: 'transfer' },
  { id: 'ignore', name: 'Ignore', kind: 'ignore' },
];
