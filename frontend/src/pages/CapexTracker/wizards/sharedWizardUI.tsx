import { useRef, useState, type ReactNode } from "react";
import { Breadcrumb } from "../Breadcrumb";

export function WizardShell({
  title,
  subtitle,
  step,
  totalSteps,
  children,
}: {
  title: string;
  subtitle: string;
  step: number;
  totalSteps: number;
  children: ReactNode;
}) {
  return (
    <div className="max-w-3xl mx-auto">
      <Breadcrumb
        items={[
          { label: "Capex Tracker", to: "/capex-tracker" },
          { label: title },
        ]}
      />
      <div className="bg-white rounded-xl border-2 border-gencom-sand p-5 shadow-sm">
        <div className="flex items-end justify-between mb-5 pb-4 border-b border-gencom-sand">
          <div>
            <div className="t-eyebrow">{subtitle}</div>
            <h1 className="t-h1 font-display uppercase tracking-wide mt-1">{title}</h1>
          </div>
          <div className="t-eyebrow">
            Step {step} <span className="text-gencom-stone/50">/</span> {totalSteps}
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

export function FieldLabel({ children, required }: { children: ReactNode; required?: boolean }) {
  return (
    <label className="block text-xs uppercase tracking-wider font-semibold text-gencom-stone mb-1">
      {children}
      {required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  value: string | number;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: "text" | "number";
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-3 py-2 border border-gencom-sand rounded-md t-body bg-white focus:outline-none focus:border-gencom-green"
    />
  );
}

export function ImageDropzone({
  imagePath,
  onPick,
  onClear,
  label = "Property image",
}: {
  imagePath: string | null;
  onPick: (file: File) => void;
  onClear?: () => void;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    onPick(files[0]);
  }

  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div
        className={`relative aspect-[16/9] rounded-md border-2 border-dashed overflow-hidden cursor-pointer transition ${
          dragOver
            ? "border-gencom-gold bg-gencom-gold/10"
            : "border-gencom-sand bg-gencom-mist hover:border-gencom-stone"
        }`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
      >
        {imagePath ? (
          <>
            <img src={imagePath} alt="" className="w-full h-full object-cover" />
            {onClear && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onClear();
                }}
                className="absolute top-2 right-2 bg-white/90 text-gencom-ink rounded-md px-2 py-1 text-xs hover:bg-white shadow"
              >
                Replace
              </button>
            )}
          </>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-center text-gencom-stone p-4">
            <div className="text-3xl mb-2">📷</div>
            <div className="text-sm">Click or drop an image</div>
            <div className="text-[11px] mt-1">PNG, JPG, WEBP, GIF</div>
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
    </div>
  );
}

export function YearRangeFields({
  yearStart,
  yearEnd,
  onChange,
}: {
  yearStart: number;
  yearEnd: number;
  onChange: (start: number, end: number) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <FieldLabel required>Year start</FieldLabel>
        <TextInput
          type="number"
          value={yearStart}
          onChange={(v) => onChange(Number(v) || yearStart, yearEnd)}
        />
      </div>
      <div>
        <FieldLabel required>Year end</FieldLabel>
        <TextInput
          type="number"
          value={yearEnd}
          onChange={(v) => onChange(yearStart, Number(v) || yearEnd)}
        />
      </div>
    </div>
  );
}

export function PrimaryButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="px-5 py-2 rounded-md bg-gencom-green text-white font-semibold text-sm hover:bg-gencom-greendark disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
    >
      {children}
    </button>
  );
}

export function GhostButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-4 py-2 rounded-md border border-gencom-sand text-gencom-stone hover:text-gencom-ink hover:border-gencom-stone text-sm"
    >
      {children}
    </button>
  );
}

export function defaultYearRange(): { start: number; end: number } {
  const now = new Date().getFullYear();
  return { start: now, end: now + 2 };
}

export function BudgetSourcePlaceholder({ allowSkip }: { allowSkip?: boolean }) {
  return (
    <div className="rounded-md border border-dashed border-gencom-sand bg-gencom-mist/40 p-5 text-sm text-gencom-stone">
      <div className="font-semibold text-gencom-ink mb-1">Budget upload — coming next round</div>
      <p>
        After you create the {allowSkip ? "project" : "hotel"}, you'll be able to upload an
        existing capex budget (PDF or Excel) or import a property's scope from the Budget
        Generator. {allowSkip && "For Project type, you can also skip this step entirely and let the budget build itself as you upload invoices."}
      </p>
      <p className="mt-2">
        For now, the wizard creates an empty budget table you can fill manually.
      </p>
    </div>
  );
}
