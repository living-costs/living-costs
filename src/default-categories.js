// Owner-editable default categories. Edit this list and push; no build step.
// Renames or type changes here never touch an existing user's category.
// Removing an entry here does nothing to existing categories.

/** @import {CategoryKind, BudgetType} from './types.js' */

/** @type {{id:string,name:string,kind:CategoryKind,budgetType?:BudgetType}[]} */
export default [
  { id: 'coffee-shops', name: 'Coffee shops', kind: 'spend', budgetType: 'variable' },
  { id: 'groceries', name: 'Groceries', kind: 'spend', budgetType: 'variable' },
  { id: 'fuel', name: 'Fuel and Parking', kind: 'spend', budgetType: 'variable' },
  { id: 'hobbies', name: 'Hobbies', kind: 'spend', budgetType: 'variable' },
  { id: 'personal-care', name: 'Personal care', kind: 'spend', budgetType: 'variable' },
  { id: 'takeaway', name: 'Takeaways', kind: 'spend', budgetType: 'variable' },
  { id: 'entertainment', name: 'Entertainment', kind: 'spend', budgetType: 'variable' },
  { id: 'shopping', name: 'Shopping', kind: 'spend', budgetType: 'variable' },
  { id: 'eating-out', name: 'Eating out', kind: 'spend', budgetType: 'variable' },
  { id: 'holidays', name: 'Holidays', kind: 'spend', budgetType: 'annual' },
  { id: 'subscriptions', name: 'Subscriptions', kind: 'spend', budgetType: 'fixed' },
  { id: 'children', name: 'Children', kind: 'spend', budgetType: 'variable' },
  { id: 'transport', name: 'Transport', kind: 'spend', budgetType: 'variable' },
  { id: 'clothing', name: 'Clothing', kind: 'spend', budgetType: 'annual' },
  { id: 'health', name: 'Health', kind: 'spend', budgetType: 'variable' },
  { id: 'gifts', name: 'Gifts', kind: 'spend', budgetType: 'annual' },
  { id: 'car', name: 'Car (fixed recurrent)', kind: 'spend', budgetType: 'fixed' },
  { id: 'charity', name: 'Charity', kind: 'spend', budgetType: 'variable' },
  { id: 'friends', name: 'Friends', kind: 'spend', budgetType: 'oneoff' },
  { id: 'big-one-offs', name: 'Big one-offs', kind: 'spend', budgetType: 'oneoff' },
  { id: 'savings', name: 'Savings', kind: 'saving', budgetType: 'variable' },
  { id: 'council-tax', name: 'Council tax', kind: 'spend', budgetType: 'annual' },
  { id: 'utilities', name: 'Utilities', kind: 'spend', budgetType: 'annual' },
  { id: 'insurance', name: 'Insurance', kind: 'spend', budgetType: 'annual' },
  { id: 'salary', name: 'Salary', kind: 'income', budgetType: 'fixed' },
  { id: 'housing', name: 'Housing (rent or mortgage)', kind: 'spend', budgetType: 'fixed' },
  { id: 'household-maintenance', name: 'Household maintenance', kind: 'spend', budgetType: 'annual' },
  { id: 'cleaner', name: 'Cleaner', kind: 'spend', budgetType: 'annual' },
  { id: 'other-income', name: 'Other income', kind: 'income', budgetType: 'variable' },
  { id: 'contributions', name: 'Contributions from others', kind: 'contribution', budgetType: 'fixed' },
  { id: 'joint-household', name: 'Joint household (contribution)', kind: 'spend', budgetType: 'fixed' },
  { id: 'bank-fees', name: 'Bank fees', kind: 'spend', budgetType: 'variable' },
  { id: 'cash-withdrawals', name: 'Cash withdrawals', kind: 'spend', budgetType: 'variable' },
  { id: 'income-tax', name: 'Income tax', kind: 'spend', budgetType: 'annual' },
  { id: 'education', name: 'Education', kind: 'spend', budgetType: 'annual' },
  { id: 'between-accounts', name: 'Transferred to another account', kind: 'transfer' },
  { id: 'card-repayments', name: 'Credit Card repayments', kind: 'transfer' },
  { id: 'work-expenses', name: 'Work expenses', kind: 'transfer' },
  { id: 'ignore', name: 'Ignore', kind: 'ignore' },
  { id: 'unknown', name: 'Unknown', kind: 'ignore' },
];
