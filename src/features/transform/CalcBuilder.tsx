import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUpRight, CornerDownRight, RotateCcw } from 'lucide-react';
import { Input, Select } from '@/components/ui/input';
import type { CalcNode } from '@/engine/history/expression';
import { compileCalc, describeCalc } from '@/engine/history/expression';
import type { ColumnSchema, OperationSpec } from '@/engine/history/operations';
import { Chip, ColumnPicker, Row } from '../shared/form';

type CalcSpec = Extract<OperationSpec, { kind: 'calculated_column' }>;
type OperandKind = 'column' | 'number' | 'text';
const numeric = (c: ColumnSchema) => c.type === 'integer' || c.type === 'decimal';
const temporal = (c: ColumnSchema) => c.type === 'date' || c.type === 'timestamp';
const textual = (c: ColumnSchema) => c.type === 'text';

function defaultOperand(kind: OperandKind, schema: ColumnSchema[], accepts: (c: ColumnSchema) => boolean): CalcNode {
  if (kind === 'number') return { kind: 'number', value: 0 };
  if (kind === 'text') return { kind: 'text', value: '' };
  const name = schema.find(accepts)?.name ?? schema[0]?.name ?? '';
  return name ? { kind: 'column', name } : { kind: 'number', value: 0 };
}

function Operand({
  label,
  value,
  onChange,
  schema,
  accepts,
  allowLiteral = true,
}: {
  label: string;
  value: CalcNode;
  onChange: (n: CalcNode) => void;
  schema: ColumnSchema[];
  accepts: (c: ColumnSchema) => boolean;
  allowLiteral?: boolean;
}) {
  const kind: OperandKind = value.kind === 'column' ? 'column' : value.kind === 'number' ? 'number' : 'text';
  const columns = schema.filter(accepts);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-slate-500">{label}</span>
      <Select
        aria-label={`${label} source`}
        value={kind}
        onChange={(e) => onChange(defaultOperand(e.target.value as OperandKind, schema, accepts))}
        className="h-8 text-xs"
      >
        <option value="column">A column</option>
        {allowLiteral && <option value="number">A number</option>}
        {allowLiteral && <option value="text">Some text</option>}
      </Select>
      {kind === 'column' && <ColumnPicker label={label} value={value.kind === 'column' ? value.name : ''} onChange={(name) => onChange({ kind: 'column', name })} columns={columns.length ? columns : schema} />}
      {kind === 'number' && (
        <Input
          aria-label={`${label} number`}
          type="number"
          value={value.kind === 'number' ? String(value.value) : '0'}
          onChange={(e) => onChange({ kind: 'number', value: Number(e.target.value) || 0 })}
          className="h-9 w-24"
        />
      )}
      {kind === 'text' && (
        <Input
          aria-label={`${label} text`}
          value={value.kind === 'text' ? value.value : ''}
          onChange={(e) => onChange({ kind: 'text', value: e.target.value })}
          placeholder="type text"
          className="h-9 w-40"
        />
      )}
    </div>
  );
}

function StepButton({ onClick, children, title }: { onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
    >
      {children}
    </button>
  );
}

/** Builds a typed CalcNode step by step; every button wraps the current result. */
export function CalcBuilder({ spec, onChange, schema }: { spec: CalcSpec; onChange: (s: OperationSpec) => void; schema: ColumnSchema[] }) {
  const [stack, setStack] = useState<CalcNode[]>(() => [spec.params.expression]);
  const current = stack[stack.length - 1]!;
  const lastEmitted = useRef<CalcNode | null>(null);
  const [operand, setOperand] = useState<CalcNode>(() => defaultOperand('number', schema, numeric));
  const [dateOperand, setDateOperand] = useState<CalcNode>(() => defaultOperand('column', schema, temporal));
  const [textOperand, setTextOperand] = useState<CalcNode>(() => defaultOperand('text', schema, textual));
  const [digits, setDigits] = useState(2);

  // A fresh spec (picked tool, undo that removed a column) resets the builder.
  useEffect(() => {
    const incoming = spec.params.expression;
    if (JSON.stringify(incoming) !== JSON.stringify(current) && JSON.stringify(incoming) !== JSON.stringify(lastEmitted.current)) {
      setStack([incoming]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec.params.expression]);

  const emit = (next: CalcNode) => {
    lastEmitted.current = next;
    setStack((s) => [...s, next]);
    onChange({ ...spec, params: { ...spec.params, expression: next } });
  };
  const undoLast = () => {
    if (stack.length < 2) return;
    const next = stack[stack.length - 2]!;
    lastEmitted.current = next;
    setStack((s) => s.slice(0, -1));
    onChange({ ...spec, params: { ...spec.params, expression: next } });
  };

  const binary = (op: 'add' | 'subtract' | 'multiply' | 'divide' | 'concat') => emit({ kind: 'binary', op, left: current, right: operand });
  const sentence = describeCalc(current, schema);
  let typeLabel: string | null = null;
  let error: string | null = null;
  try {
    typeLabel = compileCalc(current, schema).type;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="space-y-4">
      <Row label="Start with" hint="Pick a column, then add steps below. Steps can be stacked as deep as you like.">
        <ColumnPicker value={current.kind === 'column' ? current.name : ''} onChange={(name) => emit({ kind: 'column', name })} columns={schema} />
      </Row>

      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
        <p className="mb-2 text-[13px] font-medium text-slate-700">Add a step to the result</p>
        <div className="flex flex-wrap gap-1.5">
          <StepButton onClick={() => binary('add')}>+</StepButton>
          <StepButton onClick={() => binary('subtract')}>−</StepButton>
          <StepButton onClick={() => binary('multiply')}>×</StepButton>
          <StepButton onClick={() => binary('divide')}>÷</StepButton>
          <StepButton onClick={() => binary('concat')}>join text</StepButton>
          <StepButton onClick={() => emit({ kind: 'round', value: current, digits })}>round</StepButton>
          <StepButton onClick={() => emit({ kind: 'upper', value: current })}>UPPERCASE</StepButton>
          <StepButton onClick={() => emit({ kind: 'lower', value: current })}>lowercase</StepButton>
          <StepButton onClick={() => emit({ kind: 'ifEmpty', value: current, fallback: textOperand })}>if empty use…</StepButton>
          {(['year', 'month', 'day'] as const).map((part) => (
            <StepButton key={part} onClick={() => emit({ kind: 'datePart', part, value: current })}>
              {part} of date
            </StepButton>
          ))}
          <StepButton onClick={() => emit({ kind: 'daysBetween', from: current, to: dateOperand })}>days until…</StepButton>
        </div>

        <div className="mt-3 space-y-2 border-t border-slate-200 pt-3">
          <Operand label="Use with + − × ÷" value={operand} onChange={setOperand} schema={schema} accepts={numeric} />
          <Operand label="Use with join text / if empty" value={textOperand} onChange={setTextOperand} schema={schema} accepts={textual} />
          <Operand label="Use with days until" value={dateOperand} onChange={setDateOperand} schema={schema} accepts={temporal} allowLiteral={false} />
          <label className="flex items-center gap-2 text-xs text-slate-500">
            Round to
            <Input type="number" min={0} max={15} aria-label="Decimal places" value={digits} onChange={(e) => setDigits(Math.min(15, Math.max(0, Number(e.target.value) || 0)))} className="h-8 w-16" />
            decimal places
          </label>
        </div>
      </div>

      <div className="rounded-xl border border-brand-100 bg-brand-50/60 px-3 py-2.5">
        <p className="flex items-start gap-2 text-[13px] text-brand-800">
          <CornerDownRight className="mt-0.5 size-4 shrink-0" />
          <span>
            Formula: <strong className="font-semibold">{sentence}</strong>
            {typeLabel && <span className="block text-xs text-brand-700/80">Result type: {typeLabel}</span>}
          </span>
        </p>
        {error && <p className="mt-1.5 text-xs text-rose-700" role="alert">{error}</p>}
        <p className="mt-1.5 text-xs text-brand-700/80">Sample results appear in the preview below.</p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {stack.length > 1 && (
          <Chip active={false} onClick={undoLast}>
            <RotateCcw className="size-3" /> Undo last step ({stack.length - 1})
          </Chip>
        )}
        <span className="inline-flex items-center gap-1 text-xs text-slate-400">
          <ArrowUpRight className="size-3" /> Nothing is applied until you press Apply.
        </span>
      </div>
    </div>
  );
}
