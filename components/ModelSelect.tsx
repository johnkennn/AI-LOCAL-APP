'use client';

import * as Select from '@radix-ui/react-select';

interface ModelOption {
  id: string;
  name: string;
}

interface ModelSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: ModelOption[];
}

/**
 * ModelSelect：模型下拉选择器（Radix Select）。
 * 用于两处：
 * - 顶部栏：选择聊天模型（传给 /api/chat）
 * - 设置弹窗：选择 embedding 模型（传给 /api/embed）
 */
export function ModelSelect({ value, onChange, options }: ModelSelectProps) {
  /** 当前选中项展示名称（找不到则回退为 id）。 */
  const selectedName = options.find((o) => o.id === value)?.name ?? value;

  return (
    <Select.Root value={value} onValueChange={onChange}>
      <Select.Trigger
        className="inline-flex h-9 min-w-[160px] items-center justify-between gap-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-700/50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-zinc-900 data-[placeholder]:text-zinc-500 disabled:cursor-not-allowed disabled:opacity-50"
        aria-label="选择模型"
      >
        <Select.Value placeholder="选择模型">{selectedName}</Select.Value>
        <Select.Icon asChild>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="opacity-50"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          className="z-50 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 shadow-lg"
          position="popper"
          sideOffset={4}
        >
          <Select.Viewport className="p-1">
            {/* 下拉选项列表：value 为模型 id（传后端），展示为 name */}
            {options.map((opt) => (
              <Select.Item
                key={opt.id}
                value={opt.id}
                className="relative flex cursor-default select-none items-center rounded-md py-2 pl-3 pr-8 text-sm outline-none data-[highlighted]:bg-zinc-100 dark:data-[highlighted]:bg-zinc-700 data-[state=checked]:bg-blue-50 dark:data-[state=checked]:bg-blue-900/30 data-[state=checked]:text-blue-600 dark:data-[state=checked]:text-blue-400 focus:bg-zinc-100 dark:focus:bg-zinc-700"
              >
                <Select.ItemText>{opt.name}</Select.ItemText>
                <Select.ItemIndicator className="absolute right-3 inline-flex items-center">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
