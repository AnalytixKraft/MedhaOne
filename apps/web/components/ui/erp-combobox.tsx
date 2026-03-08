"use client";

import {
  Popover,
  PopoverButton,
  PopoverPanel,
} from "@headlessui/react";
import { Check, ChevronDown, Search } from "lucide-react";
import * as React from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

export type ErpComboboxOption = {
  label: string;
  value: string;
};

type ErpComboboxProps = {
  options: ErpComboboxOption[];
  value: string;
  onValueChange: (value: string) => void;
  displayValue?: string;
  onQueryChange?: (query: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  panelClassName?: string;
  optionClassName?: string;
  renderOption?: (option: ErpComboboxOption) => React.ReactNode;
  onTriggerKeyDown?: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
  onSearchKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  "data-testid"?: string;
};

type ErpComboboxInnerProps = ErpComboboxProps & {
  close: () => void;
  open: boolean;
  forwardedRef: React.ForwardedRef<HTMLButtonElement>;
};

type PanelPosition = {
  top: number;
  left: number;
  width: number;
};

function isPrintableKey(event: React.KeyboardEvent<HTMLElement>) {
  return (
    event.key.length === 1 &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey
  );
}

function assignRef<T>(ref: React.ForwardedRef<T>, value: T | null) {
  if (typeof ref === "function") {
    ref(value);
    return;
  }

  if (ref) {
    ref.current = value;
  }
}

function ErpComboboxInner({
  options,
  value,
  onValueChange,
  displayValue,
  onQueryChange,
  placeholder = "Select an option",
  searchPlaceholder = "Search...",
  emptyMessage = "No results found",
  disabled = false,
  triggerClassName,
  panelClassName,
  optionClassName,
  renderOption,
  onTriggerKeyDown,
  onSearchKeyDown,
  forwardedRef,
  open,
  close,
  "data-testid": dataTestId,
}: ErpComboboxInnerProps) {
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  const searchInputRef = React.useRef<HTMLInputElement | null>(null);
  const listId = React.useId();
  const [pendingQuery, setPendingQuery] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [highlightedIndex, setHighlightedIndex] = React.useState(0);
  const [panelPosition, setPanelPosition] = React.useState<PanelPosition | null>(null);
  const deferredQuery = React.useDeferredValue(query);

  const selectedOption = React.useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value],
  );

  const filteredOptions = React.useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return options;
    }

    return options.filter((option) =>
      `${option.label} ${option.value}`.toLowerCase().includes(normalizedQuery),
    );
  }, [deferredQuery, options]);

  const visibleValue = displayValue?.trim() || selectedOption?.label || "";

  React.useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }

    const nextQuery =
      pendingQuery ?? (selectedOption ? "" : (displayValue ?? ""));

    setQuery(nextQuery);
    if (pendingQuery !== null) {
      onQueryChange?.(nextQuery);
    }
    setPendingQuery(null);

    const frame = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      if (nextQuery) {
        const length = nextQuery.length;
        searchInputRef.current?.setSelectionRange(length, length);
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [displayValue, onQueryChange, open, pendingQuery, selectedOption]);

  React.useEffect(() => {
    if (!open) {
      return;
    }

    const selectedIndex = filteredOptions.findIndex(
      (option) => option.value === value,
    );

    setHighlightedIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [filteredOptions, open, value]);

  React.useLayoutEffect(() => {
    if (!open) {
      return;
    }

    const button = buttonRef.current;
    if (!button) {
      return;
    }

    const syncPosition = () => {
      const rect = button.getBoundingClientRect();
      const width = Math.max(rect.width, 160);
      const maxLeft = Math.max(8, window.innerWidth - width - 8);

      setPanelPosition({
        top: Math.min(rect.bottom + 6, window.innerHeight - 8),
        left: Math.min(rect.left, maxLeft),
        width,
      });
    };

    syncPosition();

    const resizeObserver = new ResizeObserver(syncPosition);
    resizeObserver.observe(button);
    window.addEventListener("resize", syncPosition);
    window.addEventListener("scroll", syncPosition, true);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", syncPosition);
      window.removeEventListener("scroll", syncPosition, true);
    };
  }, [open]);

  const focusTrigger = React.useCallback(() => {
    window.requestAnimationFrame(() => {
      buttonRef.current?.focus();
    });
  }, []);

  const openPanel = React.useCallback(
    (seedQuery?: string) => {
      if (seedQuery !== undefined) {
        setPendingQuery(seedQuery);
      }

      if (!open) {
        buttonRef.current?.click();
      }
    },
    [open],
  );

  const handleSelect = React.useCallback(
    (option: ErpComboboxOption) => {
      onQueryChange?.(option.label);
      onValueChange(option.value);
      close();
      focusTrigger();
    },
    [close, focusTrigger, onQueryChange, onValueChange],
  );

  const handleTriggerKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
  ) => {
    if (disabled) {
      return;
    }

    if (isPrintableKey(event)) {
      event.preventDefault();
      openPanel(event.key);
      return;
    }

    if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      openPanel("");
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openPanel();
      return;
    }

    onTriggerKeyDown?.(event);
    if (event.defaultPrevented) {
      return;
    }

    if (!open && event.key === "ArrowDown") {
      event.preventDefault();
      openPanel();
    }
  };

  const handleSearchKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key === "ArrowDown") {
      if (filteredOptions.length === 0) {
        return;
      }

      event.preventDefault();
      setHighlightedIndex((current) =>
        Math.min(current + 1, filteredOptions.length - 1),
      );
      return;
    }

    if (event.key === "ArrowUp") {
      if (filteredOptions.length === 0) {
        return;
      }

      event.preventDefault();
      setHighlightedIndex((current) => Math.max(current - 1, 0));
      return;
    }

    if (event.key === "Enter") {
      const option = filteredOptions[highlightedIndex] ?? filteredOptions[0];
      if (!option) {
        return;
      }

      event.preventDefault();
      handleSelect(option);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      close();
      focusTrigger();
      return;
    }

    if (event.key === "Tab") {
      close();
      return;
    }

    onSearchKeyDown?.(event);
  };

  const showPlaceholder = !visibleValue;
  const panelSelector = dataTestId ? `${dataTestId}-panel` : undefined;
  const searchSelector = dataTestId ? `${dataTestId}-search` : undefined;
  const panel = (
    <PopoverPanel
      className={cn(
        "fixed z-[250] rounded-2xl border border-[hsl(var(--card-border))] bg-[hsl(var(--card-bg))] p-2 text-[hsl(var(--text-primary))] shadow-[0_20px_48px_-24px_rgba(15,23,42,0.35)]",
        panelClassName,
      )}
      style={
        panelPosition
          ? {
              top: `${panelPosition.top}px`,
              left: `${panelPosition.left}px`,
              width: `${panelPosition.width}px`,
            }
          : undefined
      }
      data-combobox-panel={panelSelector}
    >
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--text-secondary))]" />
        <input
          ref={searchInputRef}
          type="text"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            onQueryChange?.(event.target.value);
          }}
          onKeyDown={handleSearchKeyDown}
          placeholder={searchPlaceholder}
          data-combobox-search={searchSelector}
          aria-activedescendant={
            filteredOptions[highlightedIndex]
              ? `${listId}-option-${highlightedIndex}`
              : undefined
          }
          className={cn(
            "h-11 w-full rounded-xl border border-[hsl(var(--card-border))] bg-background pl-10 pr-3 text-sm text-foreground outline-none transition-all duration-150",
            "placeholder:text-muted-foreground focus-visible:border-[hsl(var(--primary-btn))] focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary-btn))]/20 focus-visible:ring-offset-0",
          )}
        />
      </div>

      <div
        id={listId}
        role="listbox"
        className={cn(
          "mt-2 max-h-[300px] overflow-y-auto pr-1",
          "[scrollbar-color:hsl(var(--card-border))_hsl(var(--card-bg))]",
          "[&::-webkit-scrollbar]:w-[7px]",
          "[&::-webkit-scrollbar-thumb]:rounded-full",
          "[&::-webkit-scrollbar-thumb]:bg-[hsl(var(--card-border))]",
          "[&::-webkit-scrollbar-track]:bg-[hsl(var(--card-bg))]",
        )}
      >
        {filteredOptions.length === 0 ? (
          <div className="rounded-xl px-3 py-2 text-sm text-muted-foreground">
            {emptyMessage}
          </div>
        ) : (
          filteredOptions.map((option, index) => {
            const isHighlighted = index === highlightedIndex;
            const isSelected = option.value === value;

            return (
              <button
                key={option.value}
                type="button"
                id={`${listId}-option-${index}`}
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setHighlightedIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => handleSelect(option)}
                className={cn(
                  "mt-1 flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition-all duration-150 first:mt-0",
                  isSelected && "bg-[hsl(var(--primary-btn))] text-white",
                  !isSelected && isHighlighted && "bg-[hsl(var(--muted-bg))] text-[hsl(var(--text-primary))]",
                  !isSelected &&
                    !isHighlighted &&
                    "text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--muted-bg))]",
                  optionClassName,
                )}
              >
                <span className="truncate">
                  {renderOption ? renderOption(option) : option.label}
                </span>
                {isSelected ? (
                  <Check className="ml-3 h-4 w-4 shrink-0 text-white" />
                ) : null}
              </button>
            );
          })
        )}
      </div>
    </PopoverPanel>
  );

  return (
    <>
      <PopoverButton
        ref={(element) => {
          buttonRef.current = element;
          assignRef(forwardedRef, element);
        }}
        type="button"
        data-testid={dataTestId}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        disabled={disabled}
        onKeyDown={handleTriggerKeyDown}
        className={cn(
          "flex h-11 w-full items-center justify-between rounded-xl border border-[hsl(var(--card-border))] bg-background px-4 text-left text-sm shadow-sm outline-none transition-all duration-150",
          "text-[hsl(var(--text-primary))] hover:border-[hsl(var(--primary-btn))]/40 focus-visible:border-[hsl(var(--primary-btn))] focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary-btn))]/20 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-60",
          triggerClassName,
        )}
      >
        <span
          className={cn(
            "truncate pr-3",
            showPlaceholder ? "text-muted-foreground" : "text-[hsl(var(--text-primary))]",
          )}
        >
          {visibleValue || placeholder}
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-[hsl(var(--text-secondary))] transition-transform duration-150",
            open && "rotate-180",
          )}
        />
      </PopoverButton>
      {open && typeof document !== "undefined" ? createPortal(panel, document.body) : null}
    </>
  );
}

export const ErpCombobox = React.forwardRef<
  HTMLButtonElement,
  ErpComboboxProps
>(function ErpCombobox({ className, ...props }, ref) {
  return (
    <Popover className={cn("relative isolate w-full", className)}>
      {({ open, close }) => (
        <ErpComboboxInner
          {...props}
          close={close}
          open={open}
          forwardedRef={ref}
        />
      )}
    </Popover>
  );
});
