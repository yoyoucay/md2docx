-- Insert a page break at the start of the document body.
-- When pandoc adds a TOC (--toc), it appears before the body blocks,
-- so this page break lands between the TOC and the first content block.
function Pandoc(doc)
  if #doc.blocks > 0 then
    local pb = pandoc.RawBlock("openxml", '<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
    table.insert(doc.blocks, 1, pb)
  end
  return doc
end
