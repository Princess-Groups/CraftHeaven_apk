import * as React from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Search, Check, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type SearchableSelectOption = {
  id: string;
  name: string;
  /** Optional extra data attached to the option */
  [key: string]: unknown;
};

type SearchableSelectProps = {
  /** Full list of options */
  options: SearchableSelectOption[];
  /** Currently selected value (id) */
  value: string | null | undefined;
  /** Callback when a selection is made */
  onChange: (value: string | null, option: SearchableSelectOption | null) => void;
  /** Placeholder text when nothing is selected */
  placeholder?: string;
  /** Whether the user can type a custom value (for manual product entry) */
  allowManualEntry?: boolean;
  /** Called when user types a value not in the list and presses Enter / selects "Add new" */
  onManualEntry?: (typedValue: string) => void;
  /** Whether the field is disabled */
  disabled?: boolean;
  /** Extra class names on the trigger button */
  className?: string;
  /** Label shown when searching — e.g. "Search categories…" */
  searchPlaceholder?: string;
  /** Message when no results match */
  emptyMessage?: string;
};

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Select…",
  allowManualEntry = false,
  onManualEntry,
  disabled = false,
  className,
  searchPlaceholder = "Search…",
  emptyMessage = "No results found",
}: SearchableSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  const selected = React.useMemo(
    () => options.find((o) => o.id === value) ?? null,
    [options, value],
  );

  const filtered = React.useMemo(() => {
    if (!query.trim()) return options;
    const q = query.toLowerCase().trim();
    return options.filter((o) => o.name.toLowerCase().includes(q));
  }, [options, query]);

  // Whether the typed text is an exact match of an option
  const exactMatch = React.useMemo(
    () => options.some((o) => o.name.toLowerCase() === query.toLowerCase()),
    [options, query],
  );

  // Focus the input when the popover opens
  React.useEffect(() => {
    if (open) {
      // Small delay so the popover is mounted
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setQuery("");
    }
  }, [open]);

  function handleSelect(opt: SearchableSelectOption) {
    onChange(opt.id, opt);
    setOpen(false);
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation();
    onChange(null, null);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "Enter" && allowManualEntry && query.trim() && !exactMatch) {
      e.preventDefault();
      onManualEntry?.(query.trim());
      setOpen(false);
      return;
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(true)}
          className={cn(
            "flex h-10 w-full items-center justify-between rounded-lg border border-border bg-white px-3 py-2 text-sm text-left outline-none",
            "hover:border-secondary focus:border-secondary focus:ring-1 focus:ring-secondary/30 transition-colors",
            "disabled:cursor-not-allowed disabled:opacity-50",
            !selected && "text-muted-foreground",
            className,
          )}
        >
          <span className="flex items-center gap-2 min-w-0 truncate">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground/50" />
            {selected ? (
              <span className="truncate text-foreground">{selected.name}</span>
            ) : (
              <span className="truncate">{placeholder}</span>
            )}
          </span>
          <span className="flex items-center gap-1 shrink-0 ml-2">
            {selected && (
              <span
                role="button"
                tabIndex={-1}
                onClick={handleClear}
                className="rounded p-0.5 text-muted-foreground/50 hover:text-foreground hover:bg-muted"
              >
                <X className="h-3.5 w-3.5" />
              </span>
            )}
            <ChevronDown className="h-4 w-4 text-muted-foreground/50" />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-[var(--radix-popover-trigger-width)] p-0"
      >
        {/* Search input */}
        <div className="flex items-center border-b px-3">
          <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={searchPlaceholder}
            className="flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        {/* Options list */}
        <div ref={listRef} className="max-h-60 overflow-y-auto p-1">
          {filtered.length === 0 && (
            <div className="py-6 text-center text-sm text-muted-foreground">
              {allowManualEntry && query.trim() ? (
                <span>
                  Press <kbd className="rounded border bg-muted px-1 py-0.5 text-xs font-mono">Enter</kbd> to add "{query.trim()}"
                </span>
              ) : (
                emptyMessage
              )}
            </div>
          )}
          {filtered.map((opt) => {
            const isSelected = opt.id === value;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => handleSelect(opt)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm outline-none",
                  "hover:bg-secondary-soft cursor-pointer transition-colors",
                  isSelected && "bg-secondary-soft font-medium",
                )}
              >
                <Check
                  className={cn(
                    "h-4 w-4 shrink-0",
                    isSelected ? "text-secondary" : "text-transparent",
                  )}
                />
                <span className="truncate">{opt.name}</span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * A searchable combobox specifically for product names that also supports
 * manual text entry when no matching product exists in the selected category.
 */
type SearchableProductInputProps = {
  /** Products loaded for the current category */
  options: SearchableSelectOption[];
  /** Currently selected product name */
  value: string;
  /** Callback when value changes (either selection or manual typing) */
  onChange: (value: string) => void;
  /** Placeholder text */
  placeholder?: string;
  /** Whether the field is disabled */
  disabled?: boolean;
  /** Extra class names */
  className?: string;
};

export function SearchableProductInput({
  options,
  value,
  onChange,
  placeholder = "Search or type product name…",
  disabled = false,
  className,
}: SearchableProductInputProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState(value);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Sync internal query when value prop changes externally
  React.useEffect(() => {
    setQuery(value);
  }, [value]);

  const filtered = React.useMemo(() => {
    if (!query.trim()) return options;
    const q = query.toLowerCase().trim();
    return options.filter((o) => o.name.toLowerCase().includes(q));
  }, [options, query]);

  const exactMatch = React.useMemo(
    () => options.some((o) => o.name.toLowerCase() === query.toLowerCase()),
    [options, query],
  );

  React.useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  function handleSelect(opt: SearchableSelectOption) {
    onChange(opt.name);
    setQuery(opt.name);
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    // Allow free text entry — pressing Enter with unmatched text keeps the typed value
    if (e.key === "Enter") {
      if (query.trim()) {
        onChange(query.trim());
      }
      setOpen(false);
      return;
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setQuery(val);
    onChange(val);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen(true)}
          className={cn(
            "flex h-10 w-full items-center justify-between rounded-lg border border-border bg-white px-3 py-2 text-sm text-left outline-none",
            "hover:border-secondary focus:border-secondary focus:ring-1 focus:ring-secondary/30 transition-colors",
            "disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          <span className="flex items-center gap-2 min-w-0 truncate">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground/50" />
            {value ? (
              <span className="truncate text-foreground">{value}</span>
            ) : (
              <span className="truncate text-muted-foreground">{placeholder}</span>
            )}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground/50 ml-2" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-[var(--radix-popover-trigger-width)] p-0"
      >
        {/* Search / type input */}
        <div className="flex items-center border-b px-3">
          <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
          <input
            ref={inputRef}
            value={query}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        {/* Options list */}
        <div className="max-h-60 overflow-y-auto p-1">
          {filtered.length === 0 && query.trim() && (
            <div className="py-4 text-center text-sm text-muted-foreground">
              <span>
                Press <kbd className="rounded border bg-muted px-1 py-0.5 text-xs font-mono">Enter</kbd> to use "{query.trim()}" as a new product name
              </span>
            </div>
          )}
          {filtered.map((opt) => {
            const isSelected = opt.name.toLowerCase() === value.toLowerCase();
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => handleSelect(opt)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm outline-none",
                  "hover:bg-secondary-soft cursor-pointer transition-colors",
                  isSelected && "bg-secondary-soft font-medium",
                )}
              >
                <Check
                  className={cn(
                    "h-4 w-4 shrink-0",
                    isSelected ? "text-secondary" : "text-transparent",
                  )}
                />
                <span className="truncate">{opt.name}</span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
