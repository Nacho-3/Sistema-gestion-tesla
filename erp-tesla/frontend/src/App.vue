<template>
  <router-view />
</template>

<style>
html,
body,
#app {
  margin: 0;
  padding: 0;
  height: 100%;
}

body {
  background-color: #020617;
  overflow: hidden;
}

#app .modal-overlay {
  align-items: flex-start !important;
  overflow-y: auto !important;
  padding: 1.5rem 0 !important;
}

#app .modal {
  margin: 0 auto !important;
}

*,
*::before,
*::after {
  box-sizing: border-box;
}
</style>