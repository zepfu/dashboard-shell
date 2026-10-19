// Projects persisted reference-pricing metadata into a labelled cost detail.
//
// The amount is an estimate. It must stay separate from response_cost_usd and
// usd_cost: do not replace recorded spend, add the estimate into invoice
// totals, or turn an unknown invoice cost into zero.

export const REFERENCE_PRICING_LABEL = 'reference_pricing'
export const REFERENCE_PRICING_DISTINCT_LIMIT = 8
export const REFERENCE_PRICING_SEPARATION_NOTE =
  'Estimate only. Separate from recorded response cost and invoice totals.'

export const REFERENCE_PRICING_AGGREGATE_KEYS = [
  'reference_billing_modes',
  'reference_billing_mode_count',
  'reference_billing_mode_rows',
  'reference_amount_usd',
  'reference_amount_rows',
  'reference_amount_missing_rows',
  'reference_sources',
  'reference_source_count',
  'reference_source_rows',
  'reference_statuses',
  'reference_status_count',
  'reference_status_rows',
  'reference_invoice_known_rows',
  'reference_invoice_unknown_rows',
  'reference_invoice_knowledge_missing_rows',
  'reference_contract_rows',
  'reference_contract_missing_rows',
]

const FILTERED_REFERENCE_COLUMNS = {
  billingMode: 'reference_billing_mode',
  amount: 'reference_amount_value',
  source: 'reference_source',
  status: 'reference_status',
  invoiceKnown: 'reference_invoice_known',
  contractPresent: 'reference_contract_present',
}

const REFERENCE_AMOUNT_PATTERN = '^-?[0-9]+(\\.[0-9]+)?([eE][+-]?[0-9]+)?$'

function assertAlias(alias) {
  if (typeof alias !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) {
    throw new Error(`Invalid SQL alias: ${alias}`)
  }
  return alias
}

function assertMetadataExpression(expression) {
  if (
    typeof expression !== 'string' ||
    !/^(?:[A-Za-z_][A-Za-z0-9_]*\.)?metadata$/.test(expression)
  ) {
    throw new Error(`Invalid metadata expression: ${expression}`)
  }
  return expression
}

function assertMetadataKey(key) {
  if (typeof key !== 'string' || !/^[a-z0-9_]+$/.test(key)) {
    throw new Error(`Invalid metadata key: ${key}`)
  }
  return key
}

function assertBoundedLength(value) {
  if (!Number.isInteger(value) || value < 1 || value > 1000) {
    throw new Error(`Invalid text bound: ${value}`)
  }
  return value
}

function metadataText(metadataRef, key) {
  return `BTRIM(${metadataRef}->>'${assertMetadataKey(key)}')`
}

function boundedJsonTextSql(metadataRef, key, maxLength) {
  const text = metadataText(metadataRef, key)
  const limit = assertBoundedLength(maxLength)
  return `CASE
    WHEN ${text} IS NULL OR ${text} = '' THEN NULL
    WHEN left(${text}, 1) IN ('{', '[', '"') THEN NULL
    ELSE left(${text}, ${limit})
  END`
}

function referenceBillingModeSql(metadataRef) {
  return boundedJsonTextSql(metadataRef, 'billing_mode', 120)
}

function referenceStatusSql(metadataRef) {
  return boundedJsonTextSql(metadataRef, 'reference_cost_status', 120)
}

function referenceSourceSql(metadataRef) {
  return `COALESCE(${boundedJsonTextSql(metadataRef, 'reference_cost_source_label', 500)}, ${boundedJsonTextSql(metadataRef, 'reference_cost_source', 500)})`
}

function referenceAmountValueSql(metadataRef) {
  const raw = `${metadataRef}->>'reference_cost_total_usd'`
  const text = `COALESCE(${raw}, '')`
  // The empty-string coalesce only guards the numeric pattern. It is not a
  // zero-cost fallback.
  return `CASE
    WHEN ${text} ~ '${REFERENCE_AMOUNT_PATTERN}' THEN
      CASE
        WHEN (${raw})::double precision >= 0
         AND (${raw})::double precision < 'infinity'::double precision
        THEN (${raw})::double precision
      END
  END`
}

function referenceInvoiceKnownSql(metadataRef) {
  const raw = `lower(BTRIM(COALESCE(${metadataRef}->>'actual_invoice_cost_known', '')))`
  return `CASE
    WHEN ${metadataRef} ? 'actual_invoice_cost_known' AND ${raw} IN ('true', 't', '1') THEN TRUE
    WHEN ${metadataRef} ? 'actual_invoice_cost_known' AND ${raw} IN ('false', 'f', '0') THEN FALSE
    ELSE NULL
  END`
}

function referenceContractPresentSql(metadataRef) {
  return `(
    ${referenceBillingModeSql(metadataRef)} IS NOT NULL
    OR ${referenceStatusSql(metadataRef)} IS NOT NULL
    OR ${referenceSourceSql(metadataRef)} IS NOT NULL
    OR ${referenceAmountValueSql(metadataRef)} IS NOT NULL
    OR ${metadataRef} ? 'actual_invoice_cost_known'
  )`
}

function parenthesize(expression) {
  return `(${expression})`
}

function distinctTextListSql(expression) {
  const value = parenthesize(expression)
  return `COALESCE((ARRAY_AGG(DISTINCT ${value} ORDER BY ${value}) FILTER (WHERE ${value} IS NOT NULL))[1:${REFERENCE_PRICING_DISTINCT_LIMIT}], ARRAY[]::text[])`
}

function aggregateSelectSql(parts) {
  const billing = parenthesize(parts.billingMode)
  const amount = parenthesize(parts.amount)
  const source = parenthesize(parts.source)
  const status = parenthesize(parts.status)
  const invoice = parenthesize(parts.invoiceKnown)
  const contract = parenthesize(parts.contractPresent)
  return [
    `${distinctTextListSql(parts.billingMode)} AS reference_billing_modes`,
    `COUNT(DISTINCT ${billing})::double precision AS reference_billing_mode_count`,
    `COUNT(${billing})::double precision AS reference_billing_mode_rows`,
    `SUM(${amount})::double precision AS reference_amount_usd`,
    `COUNT(${amount})::double precision AS reference_amount_rows`,
    `COUNT(*) FILTER (WHERE ${amount} IS NULL)::double precision AS reference_amount_missing_rows`,
    `${distinctTextListSql(parts.source)} AS reference_sources`,
    `COUNT(DISTINCT ${source})::double precision AS reference_source_count`,
    `COUNT(${source})::double precision AS reference_source_rows`,
    `${distinctTextListSql(parts.status)} AS reference_statuses`,
    `COUNT(DISTINCT ${status})::double precision AS reference_status_count`,
    `COUNT(${status})::double precision AS reference_status_rows`,
    `COUNT(*) FILTER (WHERE ${invoice} IS TRUE)::double precision AS reference_invoice_known_rows`,
    `COUNT(*) FILTER (WHERE ${invoice} IS FALSE)::double precision AS reference_invoice_unknown_rows`,
    `COUNT(*) FILTER (WHERE ${invoice} IS NULL)::double precision AS reference_invoice_knowledge_missing_rows`,
    `COUNT(*) FILTER (WHERE ${contract} IS TRUE)::double precision AS reference_contract_rows`,
    `COUNT(*) FILTER (WHERE ${contract} IS NOT TRUE)::double precision AS reference_contract_missing_rows`,
  ].join(',\n    ')
}

export function referencePricingFilteredColumnSelectSql(alias = 'sh') {
  const metadataRef = `${assertAlias(alias)}.metadata`
  const columns = FILTERED_REFERENCE_COLUMNS
  return [
    `        ${referenceBillingModeSql(metadataRef)} AS ${columns.billingMode}`,
    `        ${referenceAmountValueSql(metadataRef)} AS ${columns.amount}`,
    `        ${referenceSourceSql(metadataRef)} AS ${columns.source}`,
    `        ${referenceStatusSql(metadataRef)} AS ${columns.status}`,
    `        ${referenceInvoiceKnownSql(metadataRef)} AS ${columns.invoiceKnown}`,
    `        ${referenceContractPresentSql(metadataRef)} AS ${columns.contractPresent}`,
  ].join(',\n')
}

export function referencePricingAggregateSelectSql(alias = 'sh', options = {}) {
  const sqlAlias = assertAlias(alias)
  if (options.fromFiltered === true) {
    const columns = FILTERED_REFERENCE_COLUMNS
    return aggregateSelectSql({
      billingMode: `${sqlAlias}.${columns.billingMode}`,
      amount: `${sqlAlias}.${columns.amount}`,
      source: `${sqlAlias}.${columns.source}`,
      status: `${sqlAlias}.${columns.status}`,
      invoiceKnown: `${sqlAlias}.${columns.invoiceKnown}`,
      contractPresent: `${sqlAlias}.${columns.contractPresent}`,
    })
  }
  const metadataRef = `${sqlAlias}.metadata`
  return aggregateSelectSql({
    billingMode: referenceBillingModeSql(metadataRef),
    amount: referenceAmountValueSql(metadataRef),
    source: referenceSourceSql(metadataRef),
    status: referenceStatusSql(metadataRef),
    invoiceKnown: referenceInvoiceKnownSql(metadataRef),
    contractPresent: referenceContractPresentSql(metadataRef),
  })
}

export function referencePricingSelectedObjectSql(
  metadataExpression = 'metadata'
) {
  const metadataRef = assertMetadataExpression(metadataExpression)
  return `jsonb_build_object(
      'measured', TRUE,
      'billing_mode', ${referenceBillingModeSql(metadataRef)},
      'reference_amount_usd', ${referenceAmountValueSql(metadataRef)},
      'source', ${referenceSourceSql(metadataRef)},
      'status', ${referenceStatusSql(metadataRef)},
      'actual_invoice_cost_known', ${referenceInvoiceKnownSql(metadataRef)},
      'contract_present', ${referenceContractPresentSql(metadataRef)}
    )`
}

export function referencePricingContractPresentSql(
  metadataExpression = 'metadata'
) {
  return referenceContractPresentSql(
    assertMetadataExpression(metadataExpression)
  )
}

function unknownDetail() {
  return {
    label: REFERENCE_PRICING_LABEL,
    billing_mode: null,
    billing_modes: [],
    billing_mode_coverage: 'unknown',
    billing_modes_truncated: false,
    reference_amount_usd: null,
    reference_amount_coverage: 'unknown',
    reference_amount_rows: 0,
    reference_amount_missing_rows: 0,
    source: null,
    sources: [],
    source_coverage: 'unknown',
    sources_truncated: false,
    status: null,
    statuses: [],
    status_coverage: 'unknown',
    statuses_truncated: false,
    actual_invoice_cost_known: null,
    actual_invoice_cost_knowledge_coverage: 'unknown',
    actual_invoice_cost_known_rows: 0,
    actual_invoice_cost_unknown_rows: 0,
    actual_invoice_cost_knowledge_missing_rows: 0,
    contract_coverage: 'unknown',
    contract_rows: 0,
    contract_missing_rows: 0,
  }
}

function asRecord(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim() !== '') {
    try {
      const parsed = JSON.parse(value)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed
      }
    } catch {
      return {}
    }
  }
  return {}
}

function cleanScalar(value, maxLength) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text) return null
  const initial = text[0]
  if (initial === '{' || initial === '[' || initial === '"') return null
  return text.length > maxLength ? text.slice(0, maxLength) : text
}

function cleanSource(value) {
  return cleanScalar(value, 500)
}

function finiteNonNegativeNumber(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'boolean') return null
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number) || number < 0) return null
  return number
}

function countOrNull(value) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'boolean') return null
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number) || number < 0) return null
  return number
}

function parseInvoiceKnown(value) {
  if (value === true || value === false) return value
  if (typeof value === 'number') {
    if (value === 1) return true
    if (value === 0) return false
    return null
  }
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase()
    if (lowered === 'true' || lowered === 't' || lowered === '1') return true
    if (lowered === 'false' || lowered === 'f' || lowered === '0') return false
  }
  return null
}

function parseBoolean(value) {
  return parseInvoiceKnown(value)
}

function parsePgArrayBody(body) {
  const items = []
  let current = ''
  let quoted = false
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index]
    if (quoted) {
      if (char === '"' && body[index + 1] === '"') {
        current += '"'
        index += 1
      } else if (char === '"') {
        quoted = false
      } else {
        current += char
      }
      continue
    }
    if (char === '"') {
      quoted = true
      continue
    }
    if (char === ',') {
      items.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (body.length > 0) items.push(current)
  return items
}

function parseTextList(value) {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string') return []
  const trimmed = value.trim()
  if (!trimmed || trimmed === '{}') return []
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return parsePgArrayBody(trimmed.slice(1, -1))
  }
  return [trimmed]
}

function boundedTexts(value, maxLength) {
  const seen = new Set()
  const bounded = []
  for (const item of parseTextList(value)) {
    const text = cleanScalar(item, maxLength)
    if (!text || seen.has(text)) continue
    seen.add(text)
    bounded.push(text)
    if (bounded.length >= REFERENCE_PRICING_DISTINCT_LIMIT) break
  }
  return bounded
}

function attributeCoverage(groupSize, presentRows, distinctCount) {
  if (groupSize <= 0) return 'unknown'
  if (presentRows <= 0) return 'missing'
  if (presentRows < groupSize) return 'partial'
  if (distinctCount > 1) return 'mixed'
  return 'known'
}

function amountCoverage(groupSize, amountRows) {
  if (groupSize <= 0) return 'unknown'
  if (amountRows <= 0) return 'missing'
  if (amountRows < groupSize) return 'partial'
  return 'known'
}

function invoiceKnowledgeCoverage(groupSize, knownRows, unknownRows) {
  const explicitRows = knownRows + unknownRows
  if (groupSize <= 0) return 'unknown'
  if (explicitRows <= 0) return 'missing'
  if (explicitRows < groupSize) return 'partial'
  if (knownRows > 0 && unknownRows > 0) return 'mixed'
  return 'known'
}

function invoiceValue(coverage, knownRows, unknownRows) {
  if (coverage === 'known' && knownRows > 0 && unknownRows === 0) return true
  if (coverage === 'known' && unknownRows > 0 && knownRows === 0) return false
  return null
}

function contractCoverage(groupSize, contractRows) {
  if (groupSize <= 0) return 'unknown'
  if (contractRows <= 0) return 'missing'
  if (contractRows < groupSize) return 'partial'
  return 'present'
}

function detailFromMeasurement(measurement) {
  const groupSize = measurement.groupSize
  const modes = boundedTexts(measurement.modes, 120)
  const sources = boundedTexts(measurement.sources, 500)
  const statuses = boundedTexts(measurement.statuses, 120)
  const modeCount = measurement.modeCount
  const sourceCount = measurement.sourceCount
  const statusCount = measurement.statusCount
  const invoiceCoverage = invoiceKnowledgeCoverage(
    groupSize,
    measurement.invoiceKnownRows,
    measurement.invoiceUnknownRows
  )
  const availableAmount =
    measurement.amountRows > 0
      ? finiteNonNegativeNumber(measurement.amount)
      : null
  return {
    label: REFERENCE_PRICING_LABEL,
    billing_mode: modes.length === 1 ? modes[0] : null,
    billing_modes: modes,
    billing_mode_coverage: attributeCoverage(
      groupSize,
      measurement.modeRows,
      modeCount
    ),
    billing_modes_truncated: modeCount > modes.length,
    reference_amount_usd: availableAmount,
    reference_amount_coverage: amountCoverage(
      groupSize,
      measurement.amountRows
    ),
    reference_amount_rows: measurement.amountRows,
    reference_amount_missing_rows: measurement.amountMissing,
    source: sources.length === 1 ? sources[0] : null,
    sources,
    source_coverage: attributeCoverage(
      groupSize,
      measurement.sourceRows,
      sourceCount
    ),
    sources_truncated: sourceCount > sources.length,
    status: statuses.length === 1 ? statuses[0] : null,
    statuses,
    status_coverage: attributeCoverage(
      groupSize,
      measurement.statusRows,
      statusCount
    ),
    statuses_truncated: statusCount > statuses.length,
    actual_invoice_cost_known: invoiceValue(
      invoiceCoverage,
      measurement.invoiceKnownRows,
      measurement.invoiceUnknownRows
    ),
    actual_invoice_cost_knowledge_coverage: invoiceCoverage,
    actual_invoice_cost_known_rows: measurement.invoiceKnownRows,
    actual_invoice_cost_unknown_rows: measurement.invoiceUnknownRows,
    actual_invoice_cost_knowledge_missing_rows: measurement.invoiceMissingRows,
    contract_coverage: contractCoverage(groupSize, measurement.contractRows),
    contract_rows: measurement.contractRows,
    contract_missing_rows: measurement.contractMissing,
  }
}

function measurementFromSelected(record) {
  const billingMode = cleanScalar(record.billing_mode, 120)
  const source = cleanSource(record.source)
  const status = cleanScalar(record.status, 120)
  const amount = finiteNonNegativeNumber(record.reference_amount_usd)
  const invoice = parseInvoiceKnown(record.actual_invoice_cost_known)
  const contractFromFlag = parseBoolean(record.contract_present)
  const contractPresent =
    contractFromFlag === true ||
    Boolean(
      billingMode || source || status || amount !== null || invoice !== null
    )
  return {
    groupSize: 1,
    modes: billingMode ? [billingMode] : [],
    modeCount: billingMode ? 1 : 0,
    modeRows: billingMode ? 1 : 0,
    amount,
    amountRows: amount === null ? 0 : 1,
    amountMissing: amount === null ? 1 : 0,
    sources: source ? [source] : [],
    sourceCount: source ? 1 : 0,
    sourceRows: source ? 1 : 0,
    statuses: status ? [status] : [],
    statusCount: status ? 1 : 0,
    statusRows: status ? 1 : 0,
    invoiceKnownRows: invoice === true ? 1 : 0,
    invoiceUnknownRows: invoice === false ? 1 : 0,
    invoiceMissingRows: invoice === null ? 1 : 0,
    contractRows: contractPresent ? 1 : 0,
    contractMissing: contractPresent ? 0 : 1,
  }
}

export function selectReferencePricingFields(metadata) {
  if (metadata === undefined || metadata === null) return null
  const record = asRecord(metadata)
  if (typeof metadata === 'string' && Object.keys(record).length === 0) {
    return null
  }
  if (typeof metadata !== 'string' && typeof metadata !== 'object') return null
  if (Array.isArray(metadata)) return null
  const billingMode = cleanScalar(record.billing_mode, 120)
  const status = cleanScalar(record.reference_cost_status, 120)
  const source =
    cleanSource(record.reference_cost_source_label) ??
    cleanSource(record.reference_cost_source)
  const amount = finiteNonNegativeNumber(record.reference_cost_total_usd)
  const invoicePresent = Object.prototype.hasOwnProperty.call(
    record,
    'actual_invoice_cost_known'
  )
  const invoice = invoicePresent
    ? parseInvoiceKnown(record.actual_invoice_cost_known)
    : null
  return {
    measured: true,
    billing_mode: billingMode,
    reference_amount_usd: amount,
    source,
    status,
    actual_invoice_cost_known: invoice,
    contract_present: Boolean(
      billingMode || status || source || amount !== null || invoicePresent
    ),
  }
}

export function projectReferencePricingSelected(selected) {
  if (selected === undefined || selected === null) return unknownDetail()
  const record = asRecord(selected)
  if (Object.keys(record).length === 0) return unknownDetail()
  return detailFromMeasurement(measurementFromSelected(record))
}

export function projectReferencePricingMetadata(metadata) {
  const selected = selectReferencePricingFields(metadata)
  if (selected === null) return unknownDetail()
  return projectReferencePricingSelected(selected)
}

function measurementFromAggregate(row) {
  const contractRows = countOrNull(row.reference_contract_rows)
  const contractMissing = countOrNull(row.reference_contract_missing_rows)
  const amountRows = countOrNull(row.reference_amount_rows)
  const amountMissing = countOrNull(row.reference_amount_missing_rows)
  if (
    contractRows === null &&
    contractMissing === null &&
    amountRows === null &&
    amountMissing === null
  ) {
    return null
  }
  const measuredContractRows = contractRows ?? 0
  const measuredContractMissing = contractMissing ?? 0
  const measuredAmountRows = amountRows ?? 0
  const measuredAmountMissing =
    amountMissing ??
    Math.max(
      measuredContractRows + measuredContractMissing - measuredAmountRows,
      0
    )
  const groupSize = Math.max(
    measuredContractRows + measuredContractMissing,
    measuredAmountRows + measuredAmountMissing
  )
  const modes = parseTextList(row.reference_billing_modes)
  const sources = parseTextList(row.reference_sources)
  const statuses = parseTextList(row.reference_statuses)
  const invoiceKnownRows = countOrNull(row.reference_invoice_known_rows) ?? 0
  const invoiceUnknownRows =
    countOrNull(row.reference_invoice_unknown_rows) ?? 0
  const invoiceMissingRows =
    countOrNull(row.reference_invoice_knowledge_missing_rows) ??
    Math.max(groupSize - invoiceKnownRows - invoiceUnknownRows, 0)
  return {
    groupSize,
    modes,
    modeCount: countOrNull(row.reference_billing_mode_count) ?? modes.length,
    modeRows: countOrNull(row.reference_billing_mode_rows) ?? 0,
    amount: finiteNonNegativeNumber(row.reference_amount_usd),
    amountRows: measuredAmountRows,
    amountMissing: measuredAmountMissing,
    sources,
    sourceCount: countOrNull(row.reference_source_count) ?? sources.length,
    sourceRows: countOrNull(row.reference_source_rows) ?? 0,
    statuses,
    statusCount: countOrNull(row.reference_status_count) ?? statuses.length,
    statusRows: countOrNull(row.reference_status_rows) ?? 0,
    invoiceKnownRows,
    invoiceUnknownRows,
    invoiceMissingRows,
    contractRows: measuredContractRows,
    contractMissing: measuredContractMissing,
  }
}

export function projectReferencePricingAggregate(row) {
  const source = row && typeof row === 'object' ? row : {}
  const measurement = measurementFromAggregate(source)
  if (measurement === null) return unknownDetail()
  return detailFromMeasurement(measurement)
}

export function attachReferencePricingDetail(row) {
  const source = row && typeof row === 'object' ? { ...row } : {}
  const detail = projectReferencePricingAggregate(source)
  for (const key of REFERENCE_PRICING_AGGREGATE_KEYS) {
    delete source[key]
  }
  source.reference_pricing = detail
  return source
}

const REFERENCE_PRICING_COVERAGES = new Set([
  'unknown',
  'missing',
  'partial',
  'known',
  'mixed',
  'present',
])

function coverageOrUnknown(value) {
  return typeof value === 'string' && REFERENCE_PRICING_COVERAGES.has(value)
    ? value
    : 'unknown'
}

function countOrZero(value) {
  return countOrNull(value) ?? 0
}

export function sanitizeReferencePricingDetail(value) {
  const record = asRecord(value)
  if (!record || record.label !== REFERENCE_PRICING_LABEL) return null
  return {
    label: REFERENCE_PRICING_LABEL,
    billing_mode: cleanScalar(record.billing_mode, 120),
    billing_modes: boundedTexts(record.billing_modes, 120),
    billing_mode_coverage: coverageOrUnknown(record.billing_mode_coverage),
    billing_modes_truncated: record.billing_modes_truncated === true,
    reference_amount_usd: finiteNonNegativeNumber(record.reference_amount_usd),
    reference_amount_coverage: coverageOrUnknown(
      record.reference_amount_coverage
    ),
    reference_amount_rows: countOrZero(record.reference_amount_rows),
    reference_amount_missing_rows: countOrZero(
      record.reference_amount_missing_rows
    ),
    source: cleanSource(record.source),
    sources: boundedTexts(record.sources, 500),
    source_coverage: coverageOrUnknown(record.source_coverage),
    sources_truncated: record.sources_truncated === true,
    status: cleanScalar(record.status, 120),
    statuses: boundedTexts(record.statuses, 120),
    status_coverage: coverageOrUnknown(record.status_coverage),
    statuses_truncated: record.statuses_truncated === true,
    actual_invoice_cost_known: parseInvoiceKnown(
      record.actual_invoice_cost_known
    ),
    actual_invoice_cost_knowledge_coverage: coverageOrUnknown(
      record.actual_invoice_cost_knowledge_coverage
    ),
    actual_invoice_cost_known_rows: countOrZero(
      record.actual_invoice_cost_known_rows
    ),
    actual_invoice_cost_unknown_rows: countOrZero(
      record.actual_invoice_cost_unknown_rows
    ),
    actual_invoice_cost_knowledge_missing_rows: countOrZero(
      record.actual_invoice_cost_knowledge_missing_rows
    ),
    contract_coverage: coverageOrUnknown(record.contract_coverage),
    contract_rows: countOrZero(record.contract_rows),
    contract_missing_rows: countOrZero(record.contract_missing_rows),
  }
}

function formatReferenceAmountUsd(value) {
  if (value === 0) return '$0.00'
  const digits =
    value >= 1
      ? 2
      : Math.min(12, Math.max(2, Math.ceil(-Math.log10(value)) + 2))
  const fixed = value.toFixed(digits)
  const trimmed = fixed.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '')
  const [whole, fraction = ''] = trimmed.split('.')
  const padded = fraction.length < 2 ? fraction.padEnd(2, '0') : fraction
  return `$${Number(whole).toLocaleString('en-US')}.${padded}`
}

function hidesUnmeasuredValue(coverage) {
  return coverage === 'missing' || coverage === 'unknown'
}

function attributeDisplayValue(single, list, coverage) {
  if (hidesUnmeasuredValue(coverage)) return null
  if (coverage === 'mixed') return list.length > 0 ? list.join(', ') : null
  if (single) return single
  if (list.length === 1) return list[0]
  return null
}

function amountDisplayValue(detail) {
  if (hidesUnmeasuredValue(detail.reference_amount_coverage)) return null
  if (detail.reference_amount_usd === null) return null
  return formatReferenceAmountUsd(detail.reference_amount_usd)
}

function invoiceDisplayValue(detail) {
  if (detail.actual_invoice_cost_known === true) return 'true'
  if (detail.actual_invoice_cost_known === false) return 'false'
  return null
}

export function referencePricingDisplayFields(value) {
  const detail = sanitizeReferencePricingDetail(value)
  if (!detail) return null
  return {
    label: REFERENCE_PRICING_LABEL,
    note: REFERENCE_PRICING_SEPARATION_NOTE,
    fields: [
      {
        key: 'billing_mode',
        label: 'Billing mode',
        value: attributeDisplayValue(
          detail.billing_mode,
          detail.billing_modes,
          detail.billing_mode_coverage
        ),
        coverage: detail.billing_mode_coverage,
        truncated: detail.billing_modes_truncated,
      },
      {
        key: 'reference_amount_usd',
        label: 'Available reference amount',
        value: amountDisplayValue(detail),
        coverage: detail.reference_amount_coverage,
        truncated: false,
      },
      {
        key: 'source',
        label: 'Source',
        value: attributeDisplayValue(
          detail.source,
          detail.sources,
          detail.source_coverage
        ),
        coverage: detail.source_coverage,
        truncated: detail.sources_truncated,
      },
      {
        key: 'status',
        label: 'Status',
        value: attributeDisplayValue(
          detail.status,
          detail.statuses,
          detail.status_coverage
        ),
        coverage: detail.status_coverage,
        truncated: detail.statuses_truncated,
      },
      {
        key: 'actual_invoice_cost_known',
        label: 'Actual invoice cost known',
        value: invoiceDisplayValue(detail),
        coverage: detail.actual_invoice_cost_knowledge_coverage,
        truncated: false,
      },
    ],
  }
}
