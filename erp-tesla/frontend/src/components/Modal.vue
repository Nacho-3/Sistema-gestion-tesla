<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal" :style="modalStyle">
      <div class="modal-header">
        <slot name="header"></slot>
        <button class="modal-close" @click="$emit('close')">×</button>
      </div>
      <div class="modal-body" :style="bodyStyle">
        <slot name="body"></slot>
      </div>
      <div class="modal-footer">
        <slot name="footer"></slot>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  maxWidth: {
    type: String,
    default: '500px',
  },
  bodyMaxHeight: {
    type: String,
    default: '60vh',
  },
})

const modalStyle = computed(() => ({
  maxWidth: props.maxWidth,
}))

const bodyStyle = computed(() => ({
  maxHeight: props.bodyMaxHeight,
}))

defineEmits(['close'])
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: rgba(15, 23, 42, 0.95);
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 0.75rem;
  width: 90%;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.5rem;
  border-bottom: 1px solid rgba(148, 163, 184, 0.2);
}

.modal-header h2 {
  margin: 0;
  color: #f9fafb;
  font-size: 1.25rem;
}

.modal-close {
  background: none;
  border: none;
  color: #9ca3af;
  font-size: 2rem;
  cursor: pointer;
  padding: 0;
  width: 2rem;
  height: 2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.2s ease;
}

.modal-close:hover {
  color: #f9fafb;
}

.modal-body {
  padding: 1.5rem;
  color: #e5e7eb;
  overflow-y: auto;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 1rem;
  padding: 1.5rem;
  border-top: 1px solid rgba(148, 163, 184, 0.2);
}
</style>
