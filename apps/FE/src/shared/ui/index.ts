/**
 * 공통 부품의 공개 API(04-3 §2 인벤토리). 밖에서는 `@/shared/ui`로만 가져온다.
 * 부품 하나 = 폴더 하나(`<Name>/<Name>.tsx` + `<Name>.module.css`). CSS에는 tokens.css 변수만 쓴다.
 */

// ── atom ──
export { Button, ButtonLink } from './Button/Button';
export type { ButtonLinkProps, ButtonProps, ButtonSize, ButtonVariant } from './Button/Button';
export { Icon } from './Icon/Icon';
export type { IconProps, IconSize } from './Icon/Icon';
export { ICON_NAMES } from './Icon/icons';
export type { IconName } from './Icon/icons';
export { IconButton } from './IconButton/IconButton';
export type { IconButtonProps, IconButtonSize } from './IconButton/IconButton';
export { StatusChip } from './StatusChip/StatusChip';
export type { StatusChipProps } from './StatusChip/StatusChip';
export { STEP_STATUS_LABEL, stepStatusLabel } from './StatusChip/statusLabel';
export type { StepFailureKind, StepStatus } from './StatusChip/statusLabel';
export { Chip } from './Chip/Chip';
export type { ChipProps, ChipTone } from './Chip/Chip';
export { GateBadge } from './GateBadge/GateBadge';
export type { GateBadgeProps } from './GateBadge/GateBadge';
export { gateBadgeLabel } from './GateBadge/gateLabel';
export type { GateState } from './GateBadge/gateLabel';
export { Num } from './Num/Num';
export type { NumAlign, NumProps } from './Num/Num';
export { formatNum } from './Num/formatNum';
export type { NumUnit, NumValue } from './Num/formatNum';
export { TextField } from './TextField/TextField';
export type { TextFieldProps } from './TextField/TextField';
export { Select } from './Select/Select';
export type { SelectProps } from './Select/Select';
export { Checkbox } from './Checkbox/Checkbox';
export type { CheckboxProps } from './Checkbox/Checkbox';
export { Radio } from './Radio/Radio';
export type { RadioProps } from './Radio/Radio';
export { Textarea } from './Textarea/Textarea';
export type { TextareaProps } from './Textarea/Textarea';
export { Switch } from './Switch/Switch';
export type { SwitchProps } from './Switch/Switch';
export { ProgressBar } from './ProgressBar/ProgressBar';
export type { ProgressBarProps } from './ProgressBar/ProgressBar';

// ── molecule ──
export { PageHeader } from './PageHeader/PageHeader';
export type { PageHeaderProps } from './PageHeader/PageHeader';
export { Panel } from './Panel/Panel';
export type { PanelProps } from './Panel/Panel';
export { Banner } from './Banner/Banner';
export type { BannerProps, BannerTone } from './Banner/Banner';
export { DataTable } from './DataTable/DataTable';
export type { DataTableAlign, DataTableColumn, DataTableProps } from './DataTable/DataTable';
export { TabPanel, Tabs } from './Tabs/Tabs';
export type { TabItem, TabPanelProps, TabsProps } from './Tabs/Tabs';
export { tabId, tabPanelId } from './Tabs/tabIds';
export { FilterToggleGroup } from './FilterToggleGroup/FilterToggleGroup';
export type {
  FilterToggleGroupProps,
  FilterToggleItem,
  FilterToggleLook,
} from './FilterToggleGroup/FilterToggleGroup';
export { Disclosure } from './Disclosure/Disclosure';
export type { DisclosureLook, DisclosureProps } from './Disclosure/Disclosure';
export { DefinitionList } from './DefinitionList/DefinitionList';
export type { DefinitionItem, DefinitionListProps } from './DefinitionList/DefinitionList';
export { DisabledReason } from './DisabledReason/DisabledReason';
export type { DisabledReasonProps, DisabledReasonTone } from './DisabledReason/DisabledReason';
export { CommandBox } from './CommandBox/CommandBox';
export type { CommandBoxProps, CommandLine } from './CommandBox/CommandBox';

// ── 임시(화면을 만드는 문서가 지운다) ──
export { ScreenPlaceholder } from './ScreenPlaceholder/ScreenPlaceholder';
export type { ScreenPlaceholderProps } from './ScreenPlaceholder/ScreenPlaceholder';
