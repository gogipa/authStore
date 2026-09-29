/** 탭과 탭 패널의 id. `Tabs`와 `TabPanel`이 같은 `idPrefix`를 쓰면 aria-controls·aria-labelledby가 맞는다. */
export function tabId(idPrefix: string, value: string): string {
  return `${idPrefix}-tab-${value}`;
}

export function tabPanelId(idPrefix: string, value: string): string {
  return `${idPrefix}-panel-${value}`;
}
