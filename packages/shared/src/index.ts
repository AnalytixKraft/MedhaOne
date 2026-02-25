export type RoleDTO = {
  id: number;
  name: string;
};

export type UserDTO = {
  id: number;
  email: string;
  full_name: string;
  is_active: boolean;
  role: RoleDTO;
};
