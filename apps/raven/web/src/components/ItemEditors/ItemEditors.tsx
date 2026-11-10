import { type ComponentProps, type ComponentType, type ReactNode, useState } from 'react'
import { Button } from '@raven/ui'
import { ImageEditor } from '@/components/ImageEditor/ImageEditor'
import { MetadataEditor } from '@/components/MetadataEditor/MetadataEditor'
import { Modal } from '@/components/Modal/Modal'
import { COMMON_COPY } from '@/lib/copy'

/** The editors an item's page opens, one at a time. */
const ITEM_EDITORS = { images: 'images', metadata: 'metadata' } as const

type ItemEditor = (typeof ITEM_EDITORS)[keyof typeof ITEM_EDITORS]

type EditorModalProps = {
  images: ComponentProps<typeof ImageEditor>
  /** Edit metadata closes the modal itself once it saves. */
  metadata: Omit<ComponentProps<typeof MetadataEditor>, 'onDone'>
  onClose: () => void
}

const ImagesModal = ({ images, onClose }: EditorModalProps) => (
  <Modal title={COMMON_COPY.editImages} onClose={onClose}>
    <ImageEditor {...images} />
  </Modal>
)

const MetadataModal = ({ metadata, onClose }: EditorModalProps) => (
  <Modal title={COMMON_COPY.editMetadata} onClose={onClose}>
    <MetadataEditor {...metadata} onDone={onClose} />
  </Modal>
)

const EDITOR_MODALS = {
  [ITEM_EDITORS.images]: ImagesModal,
  [ITEM_EDITORS.metadata]: MetadataModal,
} as const satisfies Record<ItemEditor, ComponentType<EditorModalProps>>

type UseItemEditorsProps = Omit<EditorModalProps, 'onClose'>

type ItemEditors = {
  /** Edit images and Edit metadata, for the page's header. */
  buttons: ReactNode
  /** The open editor in its modal, or nothing while neither is open. */
  modal: ReactNode
}

/**
 * Edit images and Edit metadata for an item's page: the two buttons, and
 * the one editor they open, in a modal over the page, until it closes.
 */
export const useItemEditors = (props: UseItemEditorsProps): ItemEditors => {
  const [editor, setEditor] = useState<ItemEditor | null>(null)
  const EditorModal = editor === null ? null : EDITOR_MODALS[editor]
  return {
    buttons: (
      <>
        <Button icon="edit" aria-haspopup="dialog" onClick={() => setEditor(ITEM_EDITORS.images)}>
          {COMMON_COPY.editImages}
        </Button>
        <Button icon="edit" aria-haspopup="dialog" onClick={() => setEditor(ITEM_EDITORS.metadata)}>
          {COMMON_COPY.editMetadata}
        </Button>
      </>
    ),
    modal: EditorModal && <EditorModal {...props} onClose={() => setEditor(null)} />,
  }
}
