// Owner-editable tuning values. Edit these and push; no build step.
// Changing a value only changes how results are calculated and suggested.
// It never rewrites stored data or user decisions.

export default {
  windowMonths: 12,           // typical month: latest N complete months
  variableRange: [25, 75],    // variable: typical range as percentiles
  unusualMonthPercent: 25,    // open category: a month this % away from its row's median is marked unusual
  transactionMatchDays: 3,    // transfer pairs and overlapping-row matches: ± days
  coverageGapDays: 3,         // gap between batches in one account still counted as covered
  unusualMultiple: 5,         // unusual amount: more than N × the bucket median…
  unusualMinMajor: 100,       // …and at least this many major currency units
  relatedMinWordLength: 3,    // "Looks related": shared whole word of at least N letters
  relatedStopWords: ['THE', 'LTD', 'LIMITED', 'STORES', 'UK', 'CO', 'AND'],
  relatedMaxShown: 3,
  repeatingMinCount: 3,       // "Repeating amounts": same amount at least N times
  firstTenKeys: true,         // number-key shortcuts on the categorise card
  transactionsShown: 200,     // transaction lists: show at most the first N results
};
