/** Knowledge dialog copy; UI language stays separate from speech-language detection. */
import type { Language } from "@shared/protocol";

const copy = {
  zh: {
    knowledge: "产品知识库",
    knowledgeCaption: "有出处的回答，更安心",
    source: "查看资料",
    manufacturer: "厂商资料",
    demo: "演示说明",
    uploaded: "已导入资料",
    uploadTitle: "添加产品说明",
    docTitle: "资料标题",
    docModel: "适用型号",
    docContent: "粘贴你有权使用的产品说明，或选择 .txt / .md 文件",
    upload: "导入知识库",
    uploadDone: "资料已导入。现在可以向小家提问了。",
    close: "关闭",
    knowledgeNotice: "示例说明与导入资料分开标注。导入资料仅保存在此演示服务。",
  },
  en: {
    knowledge: "Product knowledge",
    knowledgeCaption: "Helpful answers. Real sources.",
    source: "Read source",
    manufacturer: "Manufacturer reference",
    demo: "Demo guide",
    uploaded: "Imported document",
    uploadTitle: "Add a product guide",
    docTitle: "Document title",
    docModel: "Product model",
    docContent:
      "Paste product information you may use, or select a .txt / .md file",
    upload: "Add to knowledge",
    uploadDone: "Document imported. Ask Home Companion about it now.",
    close: "Close",
    knowledgeNotice:
      "Sample guides and imported documents are labeled separately. Imports stay on this demo server.",
  },
} satisfies Record<Language, Record<string, string>>;

export type Copy = typeof copy.en;

/** Return the selected UI copy without changing the agent's language policy. */
export function text(language: Language): Copy {
  return copy[language];
}
