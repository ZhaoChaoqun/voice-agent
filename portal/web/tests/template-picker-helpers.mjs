export async function expandTemplateGroup(group) {
  await group.waitFor({ state: "visible" });
  if (!await group.evaluate((element) => element.open)) {
    await group.locator(":scope > summary").click();
  }
}

export async function openTemplatePicker(page) {
  await page.getByRole("button", { name: "Load from templates", exact: true }).click();
  await expandTemplateGroup(page.locator('details[data-locale-group="en-*"]'));
}
