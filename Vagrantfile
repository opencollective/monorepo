# A persistent development machine. Provider-independent provisioning stays in .vm/.
# Vagrant requires this DSL; configuration and validation live in Node.js.
require 'json'
require 'open3'

ENV['VAGRANT_DEFAULT_PROVIDER'] ||= 'libvirt'

# Keep validation in Node so local JSON and environment overrides follow exactly
# the same rules as scripts/vm.sh. Only validated, guest-safe settings come back.
settings_json, status = Open3.capture2('node', File.join(__dir__, '.vm/config.mjs'), __dir__)
abort 'Invalid VM settings; see the Node.js error above.' unless status.success?
settings = JSON.parse(settings_json)

Vagrant.configure('2') do |config|
  config.vm.box = settings.fetch('box')
  config.vm.box_version = settings.fetch('box_version')
  config.vm.box_check_update = false
  config.vm.hostname = 'oc-dev'
  # The guest owns its /workspace checkout. Host-folder sync at /vagrant is
  # configurable; Vagrant/provider defaults choose the sync implementation.
  config.vm.synced_folder '.', '/vagrant', disabled: !settings.fetch('share_host_folder')
  config.ssh.insert_key = true
  # Provisioning never borrows the developer's agent. The external oc-dev entry
  # forwards an existing host agent only after explicit setup approval.
  config.ssh.forward_agent = false
  config.ssh.forward_x11 = false

  # Keep provider-specific resource and network controls in this block so another
  # provider can reuse the guest scripts without inheriting libvirt-only options.
  config.vm.provider :libvirt do |libvirt|
    libvirt.driver = 'kvm'
    libvirt.cpus = settings.fetch('cpus')
    libvirt.memory = settings.fetch('memory_mb')
    # This controls initial disk capacity; the guest provisioner grows its root
    # partition/filesystem. It does not resize an already-created libvirt volume.
    libvirt.machine_virtual_size = settings.fetch('disk_gb')
    libvirt.storage_pool_name = settings.fetch('storage_pool')
    libvirt.management_network_name = settings.fetch('network_name')
    libvirt.management_network_address = settings.fetch('network_address')
    # Private NAT provides outbound access without bridging the VM onto the LAN.
    libvirt.management_network_mode = 'nat'
    libvirt.management_network_guest_ipv6 = false
    libvirt.graphics_type = 'none'
    libvirt.autostart = false
  end

  # Explicit uploads are provisioning inputs, not host filesystem shares.
  # File provisioners upload as vagrant, so prepare a user-writable staging area
  # before the root provisioner installs these assets under /opt/oc-vm.
  config.vm.provision 'shell', inline: 'install -d -o vagrant -g vagrant -m 700 /tmp/oc-vm /tmp/oc-vm/shared'
  Dir.glob(File.join(__dir__, '.vm', '*')).select { |path| File.file?(path) }.each do |path|
    config.vm.provision 'file', source: path, destination: "/tmp/oc-vm/#{File.basename(path)}"
  end
  %w[init.sh install-dependencies.sh start-dependencies.sh run.sh test.sh].each do |script|
    config.vm.provision 'file', source: "scripts/#{script}", destination: "/tmp/oc-vm/shared/#{script}"
  end
  config.vm.provision 'file', source: '.devcontainer/shell-aliases.sh', destination: '/tmp/oc-vm/shared/shell-aliases.sh'
  config.vm.provision 'shell', path: '.vm/provision.sh', args: [JSON.generate(settings)]
end
